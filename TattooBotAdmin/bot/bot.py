import logging
import os
import random
import re
import time
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Dict, List, Optional

import requests
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, InputMediaPhoto, InputMediaVideo, ParseMode
from telegram.ext import (
    CallbackContext,
    CallbackQueryHandler,
    CommandHandler,
    ConversationHandler,
    Filters,
    MessageHandler,
    Updater,
)

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover - Python < 3.9
    from dateutil import tz as _tz  # type: ignore

    class ZoneInfo:  # type: ignore
        def __init__(self, name: str):
            self._tz = _tz.gettz(name)

        def utcoffset(self, dt):
            return self._tz.utcoffset(dt)

        def dst(self, dt):
            return self._tz.dst(dt)

        def tzname(self, dt):
            return self._tz.tzname(dt)

        def fromutc(self, dt):
            return self._tz.fromutc(dt)

        def __repr__(self) -> str:
            return f"ZoneInfoFallback({self._tz})"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("tattoo-bot")

API_BASE_ENV = os.getenv("API_BASE")
API_CANDIDATES = [
    API_BASE_ENV,
    "http://tattoobotadmin-app-1:6050",
    "http://app:6050",
    "http://localhost:6050",
]
TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TZ_NAME = os.getenv("TZ", "Europe/Moscow")
try:
    TZ = ZoneInfo(TZ_NAME)
except Exception:  # pragma: no cover
    log.warning("Unknown timezone %s, falling back to UTC", TZ_NAME)
    TZ = ZoneInfo("UTC")

BUTTON_BACK = "↩️ Назад"
RU_WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

_messages_cache: Dict[str, Any] = {"data": {}, "ts": 0.0}
_settings_cache: Dict[str, Any] = {"data": {}, "ts": 0.0}


@dataclass
class ApiError(Exception):
    status: int
    message: str


def api_get(path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    last_error: Optional[Exception] = None
    for base in API_CANDIDATES:
        if not base:
            continue
        try:
            response = requests.get(base + path, params=params or {}, timeout=15)
            if response.status_code >= 400:
                try:
                    data = response.json()
                    raise ApiError(response.status_code, data.get("message", response.text))
                except ValueError:
                    raise ApiError(response.status_code, response.text)
            return response.json() if response.content else {}
        except Exception as error:  # pragma: no cover - network failures
            last_error = error
    if last_error:
        raise last_error
    raise RuntimeError("API is not reachable")


def api_post(path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    last_error: Optional[Exception] = None
    for base in API_CANDIDATES:
        if not base:
            continue
        try:
            response = requests.post(base + path, json=payload, timeout=20)
            if response.status_code >= 400:
                try:
                    data = response.json()
                    raise ApiError(response.status_code, data.get("message", response.text))
                except ValueError:
                    raise ApiError(response.status_code, response.text)
            return response.json() if response.content else {}
        except ApiError:
            raise
        except Exception as error:  # pragma: no cover
            last_error = error
    if last_error:
        raise last_error
    raise RuntimeError("API is not reachable")


def safe_get_settings(force: bool = False) -> Dict[str, Any]:
    now = time.time()
    if not force and now - _settings_cache["ts"] < 60:
        return _settings_cache["data"]
    try:
        data = api_get("/api/bot/settings")
        settings = data.get("settings", {}) if isinstance(data, dict) else {}
        _settings_cache.update({"data": settings, "ts": now})
        return settings
    except Exception as error:  # pragma: no cover
        log.warning("settings fetch failed: %s", error)
        return _settings_cache["data"]


def safe_get_messages(force: bool = False) -> Dict[str, str]:
    now = time.time()
    if not force and now - _messages_cache["ts"] < 60:
        return _messages_cache["data"]
    try:
        data = api_get("/api/bot/messages")
        messages: Dict[str, str] = {}
        for item in data.get("messages", []):
            key = item.get("key")
            value = item.get("value")
            if isinstance(key, str) and isinstance(value, str):
                messages[key] = value
        _messages_cache.update({"data": messages, "ts": now})
        return messages
    except Exception as error:  # pragma: no cover
        log.warning("messages fetch failed: %s", error)
        return _messages_cache["data"]


def get_message(key: str, default: str) -> str:
    value = safe_get_messages().get(key, "").strip()
    return value or default


def render_template(template: str, **values: Any) -> str:
    try:
        return template.format(**values)
    except Exception:
        return template


def safe_get_services() -> List[Dict[str, Any]]:
    try:
        data = api_get("/api/bot/services")
        services = data.get("services", [])
        result = []
        for service in services:
            if not isinstance(service, dict):
                continue
            result.append(
                {
                    "id": service.get("id"),
                    "name": service.get("name", "Услуга"),
                    "duration": int(service.get("duration", 60) or 60),
                    "price": int(service.get("price", 0) or 0),
                }
            )
        return result
    except ApiError as error:
        log.warning("services fetch failed: %s", error.message)
        return []
    except Exception as error:  # pragma: no cover
        log.warning("services fetch failed: %s", error)
        return []


def safe_get_availability(service_id: str, days: int = 30) -> List[Dict[str, Any]]:
    try:
        data = api_get("/api/bot/availability/calendar", {"serviceId": service_id, "days": days})
        availability = []
        for item in data.get("availability", []):
            if isinstance(item, dict) and item.get("slots"):
                availability.append(item)
        return availability
    except ApiError as error:
        log.warning("availability fetch failed: %s", error.message)
        return []
    except Exception as error:  # pragma: no cover
        log.warning("availability fetch failed: %s", error)
        return []


def safe_get_slot_masters(service_id: str, day: str, time_str: str) -> List[Dict[str, Any]]:
    try:
        data = api_get(
            "/api/bot/availability/masters",
            {"serviceId": service_id, "date": day, "time": time_str},
        )
        masters = []
        for item in data.get("masters", []):
            if isinstance(item, dict):
                masters.append(item)
        return masters
    except ApiError as error:
        log.warning("slot masters fetch failed: %s", error.message)
        return []
    except Exception as error:  # pragma: no cover
        log.warning("slot masters fetch failed: %s", error)
        return []


def safe_get_masters(include_inactive: bool = False) -> List[Dict[str, Any]]:
    try:
        data = api_get("/api/bot/masters", {"includeInactive": str(include_inactive).lower()})
        masters = []
        for master in data.get("masters", []):
            if isinstance(master, dict):
                masters.append(master)
        return masters
    except ApiError as error:
        log.warning("masters fetch failed: %s", error.message)
        return []
    except Exception as error:  # pragma: no cover
        log.warning("masters fetch failed: %s", error)
        return []


def safe_get_portfolio(master_id: Optional[str] = None, limit: int = 6) -> List[Dict[str, Any]]:
    params: Dict[str, Any] = {"page": 1, "pageSize": limit}
    if master_id:
        params["masterId"] = master_id
    try:
        data = api_get("/api/portfolio", params)
        items = data.get("portfolio") or data.get("items") or []
        result = []
        for item in items:
            if not isinstance(item, dict):
                continue
            result.append(item)
        return result
    except Exception as error:  # pragma: no cover
        log.warning("portfolio fetch failed: %s", error)
        return []


def safe_create_booking(payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        return api_post("/api/bot/bookings", payload)
    except ApiError as error:
        raise error


def money(value: int) -> str:
    try:
        return f"{int(value):,}".replace(",", " ") + " ₽"
    except Exception:
        return str(value)


# ===== conversation states =====
S_CAPTCHA, S_SVC, S_DATE, S_TIME, S_MASTER, S_NAME, S_PHONE = range(7)

verified_users: set = set()
user_captcha: Dict[int, tuple] = {}


def build_main_keyboard() -> InlineKeyboardMarkup:
    btn_booking = get_message("button_booking", "📅 Записаться")
    btn_portfolio = get_message("button_portfolio", "🖼️ Портфолио")
    btn_location = get_message("button_location", "📍 Как добраться")
    return InlineKeyboardMarkup(
        [
            [InlineKeyboardButton(btn_booking, callback_data="book")],
            [
                InlineKeyboardButton(btn_location, callback_data="route"),
                InlineKeyboardButton("👥 О мастерах", callback_data="about"),
            ],
            [InlineKeyboardButton(btn_portfolio, callback_data="portfolio")],
            [InlineKeyboardButton("💳 Оплата", callback_data="pay")],
        ]
    )


def keyboard_back_home() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[InlineKeyboardButton(BUTTON_BACK, callback_data="home")]])


# ===== /start + captcha =====
def cmd_start(update, ctx: CallbackContext):
    user_id = update.effective_user.id
    if user_id not in verified_users:
        a, b = random.randint(1, 9), random.randint(1, 9)
        user_captcha[user_id] = (a, b)
        update.message.reply_text(
            f"Привет! Для защиты от спама реши капчу: *{a}+{b}* = ?",
            parse_mode=ParseMode.MARKDOWN,
        )
        return S_CAPTCHA
    send_home_text(update, ctx)
    return ConversationHandler.END


def on_captcha(update, ctx: CallbackContext):
    user_id = update.effective_user.id
    answer = (update.message.text or "").strip()
    a, b = user_captcha.get(user_id, (None, None))
    if a is None:
        return ConversationHandler.END
    if answer.isdigit() and int(answer) == a + b:
        verified_users.add(user_id)
        user_captcha.pop(user_id, None)
        send_home_text(update, ctx)
        return ConversationHandler.END
    update.message.reply_text("Неа. Пришли число ещё раз.")
    return S_CAPTCHA


def send_home_text(update_or_query, ctx: CallbackContext):
    settings = safe_get_settings()
    intro = get_message(
        "welcome",
        "👋 Привет! Я бот тату-студии.\n"
        "• Запись в пару кликов\n• Напомню о визите\n• Покажу маршрут до студии\n\nРаботаю 24/7.",
    )
    if getattr(update_or_query, "message", None):
        update_or_query.message.reply_text(
            render_template(intro, studio=settings.get("studioName", "")),
            parse_mode=ParseMode.MARKDOWN,
            reply_markup=build_main_keyboard(),
        )
    else:
        update_or_query.callback_query.edit_message_text(
            render_template(intro, studio=settings.get("studioName", "")),
            parse_mode=ParseMode.MARKDOWN,
            reply_markup=build_main_keyboard(),
        )


# ===== booking flow =====
def entry_book(update, ctx: CallbackContext):
    query = update.callback_query
    query.answer()

    services = safe_get_services()
    if not services:
        query.edit_message_text("Нет доступных услуг. Попробуйте позже.", reply_markup=keyboard_back_home())
        return ConversationHandler.END

    ctx.user_data.clear()
    ctx.user_data["services"] = {str(service["id"]): service for service in services if service.get("id")}

    buttons = [
        [
            InlineKeyboardButton(
                f"{service['name']} • {money(service['price'])}", callback_data=f"svc:{service['id']}"
            )
        ]
        for service in services[:30]
    ]
    buttons.append([InlineKeyboardButton(BUTTON_BACK, callback_data="home")])
    query.edit_message_text("Выбери услугу:", reply_markup=InlineKeyboardMarkup(buttons))
    return S_SVC


def pick_service(update, ctx: CallbackContext):
    query = update.callback_query
    query.answer()
    _, service_id = query.data.split(":", 1)

    services = ctx.user_data.get("services", {})
    service = services.get(service_id)
    if not service:
        query.edit_message_text("Не удалось найти услугу. Попробуйте снова.", reply_markup=keyboard_back_home())
        return ConversationHandler.END

    ctx.user_data["service_id"] = service_id

    availability = safe_get_availability(service_id)
    if not availability:
        query.edit_message_text(
            "Свободных дат для этой услуги нет. Попробуйте позже.",
            reply_markup=keyboard_back_home(),
        )
        return ConversationHandler.END

    ctx.user_data["availability"] = {item["date"]: item for item in availability}

    rows: List[List[InlineKeyboardButton]] = []
    row: List[InlineKeyboardButton] = []
    for index, day in enumerate(availability, start=1):
        label_date = datetime.strptime(day["date"], "%Y-%m-%d").strftime("%d.%m")
        weekday = day.get("weekdayShort") or RU_WEEKDAYS[
            datetime.strptime(day["date"], "%Y-%m-%d").weekday()
        ]
        row.append(InlineKeyboardButton(f"{label_date} ({weekday})", callback_data=f"d:{day['date']}"))
        if index % 3 == 0:
            rows.append(row)
            row = []
    if row:
        rows.append(row)
    rows.append([InlineKeyboardButton(BUTTON_BACK, callback_data="book")])

    booking_template = get_message(
        "booking_start",
        "Услуга: {service}\nДлительность: {duration} мин\nЦена: {price}\n\nВыберите дату:",
    )
    message_text = render_template(
        booking_template,
        service=service.get("name", "Услуга"),
        duration=service.get("duration", 60),
        price=money(service.get("price", 0)),
    )

    query.edit_message_text(message_text, parse_mode=ParseMode.MARKDOWN, reply_markup=InlineKeyboardMarkup(rows))
    return S_DATE


def pick_date(update, ctx: CallbackContext):
    query = update.callback_query
    query.answer()
    _, day = query.data.split(":", 1)

    availability = ctx.user_data.get("availability", {})
    day_data = availability.get(day)
    if not day_data:
        query.edit_message_text("Не удалось получить слот на эту дату.", reply_markup=keyboard_back_home())
        return ConversationHandler.END

    ctx.user_data["date"] = day

    slots = day_data.get("slots", [])
    if not slots:
        query.edit_message_text("На выбранную дату слотов нет. Выберите другую дату.", reply_markup=keyboard_back_home())
        return ConversationHandler.END

    rows: List[List[InlineKeyboardButton]] = []
    row: List[InlineKeyboardButton] = []
    for index, slot in enumerate(slots, start=1):
        masters_count = len(slot.get("masters", []))
        label = slot["time"]
        if masters_count:
            label = f"{label} • {masters_count}"
        row.append(InlineKeyboardButton(label, callback_data=f"t:{slot['time']}"))
        if index % 4 == 0:
            rows.append(row)
            row = []
    if row:
        rows.append(row)
    rows.append([InlineKeyboardButton(BUTTON_BACK, callback_data=f"svc:{ctx.user_data['service_id']}")])

    query.edit_message_text("Выбери время:", reply_markup=InlineKeyboardMarkup(rows))
    return S_TIME


def pick_time(update, ctx: CallbackContext):
    query = update.callback_query
    query.answer()
    _, time_value = query.data.split(":", 1)

    ctx.user_data["time"] = time_value

    service_id = ctx.user_data.get("service_id")
    date_value = ctx.user_data.get("date")
    if not service_id or not date_value:
        query.edit_message_text("Произошла ошибка. Попробуйте записаться заново.", reply_markup=keyboard_back_home())
        return ConversationHandler.END

    masters = safe_get_slot_masters(service_id, date_value, time_value)
    if not masters:
        query.edit_message_text(
            "На это время пока нет свободных мастеров. Выберите другой слот.",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton(BUTTON_BACK, callback_data=f"d:{date_value}")]]),
        )
        return S_TIME

    ctx.user_data["masters"] = {str(master.get("id")): master for master in masters if master.get("id")}

    rows = [
        [
            InlineKeyboardButton(
                f"{master.get('nickname') or master.get('name')} • {master.get('specialization', '')}",
                callback_data=f"m:{master.get('id')}",
            )
        ]
        for master in masters
    ]
    rows.append([InlineKeyboardButton(BUTTON_BACK, callback_data=f"t:{time_value}")])

    query.edit_message_text("К кому записаться?", reply_markup=InlineKeyboardMarkup(rows))
    return S_MASTER


def pick_master(update, ctx: CallbackContext):
    query = update.callback_query
    query.answer()
    _, master_id = query.data.split(":", 1)
    masters = ctx.user_data.get("masters", {})
    if master_id not in masters:
        query.edit_message_text("Не удалось выбрать мастера.", reply_markup=keyboard_back_home())
        return ConversationHandler.END

    ctx.user_data["master_id"] = master_id
    query.edit_message_text(
        "Как к тебе обращаться? Напиши имя (можно просто как тебя обычно называют).",
        reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton(BUTTON_BACK, callback_data=f"t:{ctx.user_data['time']}")]]),
    )
    return S_NAME


def ask_phone(update, ctx: CallbackContext):
    name = (update.message.text or "").strip()
    if len(name) < 2:
        update.message.reply_text("Имя слишком короткое. Пришли нормальное имя 🙂")
        return S_NAME
    ctx.user_data["client_name"] = name
    update.message.reply_text("Огонь! А теперь номер телефона для связи (можно +7... или 8...).")
    return S_PHONE


PHONE_RX = re.compile(r"^\+?\d[\d \-()]{8,}$")


def finalize_booking(update, ctx: CallbackContext):
    phone = (update.message.text or "").strip()
    if not PHONE_RX.match(phone):
        update.message.reply_text("Кажется, это не похоже на номер. Пришли номер в формате +7XXXXXXXXXX.")
        return S_PHONE

    service_id = ctx.user_data.get("service_id")
    master_id = ctx.user_data.get("master_id")
    date_value = ctx.user_data.get("date")
    time_value = ctx.user_data.get("time")
    service = ctx.user_data.get("services", {}).get(service_id, {})

    payload = {
        "serviceId": service_id,
        "masterId": master_id,
        "date": date_value,
        "time": time_value,
        "clientName": ctx.user_data.get("client_name"),
        "clientPhone": phone,
        "clientTelegram": update.effective_user.username,
    }

    try:
        safe_create_booking(payload)
    except ApiError as error:
        update.message.reply_text(
            error.message or "Не удалось подтвердить запись. Попробуй другое время.",
            reply_markup=keyboard_back_home(),
        )
        return ConversationHandler.END

    settings = safe_get_settings()
    master = ctx.user_data.get("masters", {}).get(master_id, {})
    date_label = datetime.strptime(date_value, "%Y-%m-%d").strftime("%d.%m.%Y") if date_value else ""

    template = get_message(
        "booking_confirmed",
        "✅ Запись подтверждена!\n\nУслуга: {service}\nДата и время: {date} • {time}\nАдрес: {address}\n\nДо встречи!",
    )
    confirmation = render_template(
        template,
        service=service.get("name", "Услуга"),
        date=date_label,
        time=time_value,
        address=settings.get("address", "Адрес уточним в чате"),
    )

    if master:
        confirmation += f"\nМастер: {master.get('name') or master.get('nickname', '')}".rstrip()

    update.message.reply_text(confirmation, parse_mode=ParseMode.MARKDOWN, reply_markup=keyboard_back_home())
    return ConversationHandler.END


# ===== generic buttons outside of conversation =====
def handle_buttons(update, ctx: CallbackContext):
    query = update.callback_query
    query.answer()
    data = query.data

    if data == "home":
        send_home_text(update, ctx)
        return

    if data == "route":
        handle_route(query)
        return

    if data == "about":
        handle_about(query)
        return

    if data == "portfolio":
        handle_portfolio(query)
        return

    if data == "pay":
        handle_payment(query)
        return


def handle_route(query):
    settings = safe_get_settings()
    address = settings.get("address", "Адрес не указан")
    latitude = settings.get("latitude") or settings.get("lat")
    longitude = settings.get("longitude") or settings.get("lon") or settings.get("lng")

    parts = [f"📍 *Адрес:* {address}"]

    if latitude and longitude:
        try:
            lat = float(str(latitude).replace(",", "."))
            lon = float(str(longitude).replace(",", "."))
        except ValueError:
            lat = lon = None
        else:
            yandex_link = f"https://yandex.ru/maps/?pt={lon},{lat}&z=16&l=map"
            google_link = f"https://maps.google.com/?q={lat},{lon}"
            parts.append(f"[Открыть в Яндекс.Картах]({yandex_link})")
            parts.append(f"[Открыть в Google Maps]({google_link})")

            static_candidates = [
                f"https://static-maps.yandex.ru/1.x/?ll={lon},{lat}&z=16&l=map&size=650,300&pt={lon},{lat},pm2blm&lang=ru_RU",
                f"https://staticmap.openstreetmap.de/staticmap.php?center={lat},{lon}&zoom=16&size=650x300&markers={lat},{lon}",
            ]
            sent_media = False
            for url in static_candidates:
                try:
                    query.message.bot.send_photo(chat_id=query.message.chat_id, photo=url)
                    sent_media = True
                    break
                except Exception as error:
                    log.debug("static map try failed: %s", error)
            try:
                query.message.bot.send_location(chat_id=query.message.chat_id, latitude=lat, longitude=lon)
                sent_media = True
            except Exception as error:
                log.debug("send_location failed: %s", error)
            if not sent_media:
                log.info("Could not send location media, continue with text only")

    query.message.bot.send_message(
        chat_id=query.message.chat_id,
        text="\n".join(parts),
        parse_mode=ParseMode.MARKDOWN,
        reply_markup=keyboard_back_home(),
    )


def handle_about(query):
    masters = [master for master in safe_get_masters() if master.get("isActive", True)]
    if not masters:
        query.edit_message_text("Пока нет активных мастеров.", reply_markup=keyboard_back_home())
        return
    for master in masters[:10]:
        caption = f"*{master.get('name', 'Мастер')}*"
        if master.get("specialization"):
            caption += f"\n{master['specialization']}"
        if master.get("telegram"):
            caption += f"\n@{master['telegram']}"
        photo = master.get("avatar")
        try:
            if photo:
                query.message.bot.send_photo(
                    chat_id=query.message.chat_id,
                    photo=photo,
                    caption=caption,
                    parse_mode=ParseMode.MARKDOWN,
                )
            else:
                query.message.bot.send_message(
                    chat_id=query.message.chat_id, text=caption, parse_mode=ParseMode.MARKDOWN
                )
        except Exception as error:
            log.debug("failed to send master card: %s", error)
    query.message.reply_text("Это наши мастера 👆", reply_markup=keyboard_back_home())


def handle_portfolio(query):
    items = safe_get_portfolio(limit=6)
    if not items:
        query.edit_message_text("Портфолио пока пусто.", reply_markup=keyboard_back_home())
        return

    media_group: List[Any] = []
    for item in items:
        media_type = (item.get("mediaType") or "image").lower()
        url = item.get("url") or item.get("image")
        caption = item.get("title") or item.get("caption")
        if not url:
            continue
        if media_type == "video":
            media_group.append(InputMediaVideo(media=url, caption=caption))
        else:
            media_group.append(InputMediaPhoto(media=url, caption=caption))
        if len(media_group) >= 6:
            break

    if media_group:
        try:
            query.message.bot.send_media_group(chat_id=query.message.chat_id, media=media_group)
        except Exception as error:
            log.debug("portfolio media group failed: %s", error)
    query.message.reply_text("Портфолио", reply_markup=keyboard_back_home())


def handle_payment(query):
    settings = safe_get_settings()
    payment = settings.get("paymentMethods") or settings.get("paymentInfo")
    if payment:
        text = f"💳 *Оплата*\n\n{payment}"
    else:
        text = (
            "💳 *Оплата*\n\n" "• Наличные в студии\n" "• СБП (по номеру телефона)\n" "• Банковские карты\n"
        )
    query.edit_message_text(text, parse_mode=ParseMode.MARKDOWN, reply_markup=keyboard_back_home())


def cmd_ping(update, _ctx):
    update.message.reply_text("pong")


def main():
    if not TOKEN:
        log.error("TELEGRAM_BOT_TOKEN is empty – set token in admin.")
        while True:
            time.sleep(30)

    updater = Updater(TOKEN, use_context=True)
    dispatcher = updater.dispatcher

    conv = ConversationHandler(
        entry_points=[
            CommandHandler("start", cmd_start),
            CallbackQueryHandler(entry_book, pattern=r"^book$"),
        ],
        states={
            S_CAPTCHA: [MessageHandler(Filters.text & ~Filters.command, on_captcha)],
            S_SVC: [CallbackQueryHandler(pick_service, pattern=r"^svc:.+")],
            S_DATE: [CallbackQueryHandler(pick_date, pattern=r"^d:.+")],
            S_TIME: [CallbackQueryHandler(pick_time, pattern=r"^t:.+")],
            S_MASTER: [CallbackQueryHandler(pick_master, pattern=r"^m:.+")],
            S_NAME: [MessageHandler(Filters.text & ~Filters.command, ask_phone)],
            S_PHONE: [MessageHandler(Filters.text & ~Filters.command, finalize_booking)],
        },
        fallbacks=[CallbackQueryHandler(handle_buttons)],
        allow_reentry=True,
    )

    dispatcher.add_handler(conv)
    dispatcher.add_handler(CallbackQueryHandler(handle_buttons))
    dispatcher.add_handler(CommandHandler("ping", cmd_ping))

    log.info("Bot starting polling...")
    updater.start_polling()
    updater.idle()


if __name__ == "__main__":
    main()
