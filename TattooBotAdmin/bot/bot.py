import os, logging, requests, random, time, re
from datetime import datetime, timedelta, time as dtime, date
from dateutil import tz
from telegram import (
    InlineKeyboardMarkup, InlineKeyboardButton, InputMediaPhoto, ParseMode
)
from telegram.ext import (
    Updater, CommandHandler, CallbackQueryHandler, ConversationHandler,
    MessageHandler, Filters, CallbackContext
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("tattoo-bot")

# ===== API discovery =====
_api_env = os.getenv("API_BASE")
API_CANDIDATES = [
    _api_env,
    "http://tattoobotadmin-app-1:6050",  # имя твоего контейнера app
    "http://app:6050",
    "http://localhost:6050",
]
TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TZ = tz.gettz(os.getenv("TZ", "Europe/Moscow"))

# ===== helpers =====
RU_DOW = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

def api_get(path, params=None):
    last_err = None
    for base in API_CANDIDATES:
        if not base: continue
        try:
            r = requests.get(base + path, params=params or {}, timeout=10)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            last_err = e
    raise last_err

def api_post(path, payload):
    last_err = None
    for base in API_CANDIDATES:
        if not base: continue
        try:
            r = requests.post(base + path, json=payload, timeout=15)
            r.raise_for_status()
            return r.json() if r.content else {}
        except Exception as e:
            # полезно увидеть текст ошибки бэкенда
            try:
                txt = r.text
                log.warning("api_post %s failed: %s :: %s", path, e, txt)
            except: pass
            last_err = e
    raise last_err

def safe_get_settings():
    try:
        data = api_get("/api/settings")
        return data.get("settings", {}) if isinstance(data, dict) else {}
    except Exception as e:
        log.warning("settings fetch failed: %s", e)
        return {}

def safe_get_services():
    try:
        data = api_get("/api/services")
        items = data.get("services", []) if isinstance(data, dict) else []
        out = []
        for s in items:
            out.append({
                "id": s.get("id"),
                "name": s.get("name") or s.get("title") or "Услуга",
                "duration": int(s.get("duration", 60)),
                "price": int(s.get("price", 0)),
            })
        return out
    except Exception as e:
        log.warning("services fetch failed: %s", e)
        return []

def safe_get_portfolio():
    try:
        data = api_get("/api/portfolio")
        items = data.get("portfolio", []) if isinstance(data, dict) else []
        out = []
        for p in items:
            out.append({
                "image": p.get("imageUrl") or p.get("image") or p.get("url"),
                "caption": p.get("caption") or p.get("title") or ""
            })
        return out
    except Exception as e:
        log.warning("portfolio fetch failed: %s", e)
        return []

def safe_get_masters():
    try:
        data = api_get("/api/masters")
        items = data.get("masters", []) if isinstance(data, dict) else []
        out = []
        for m in items:
            out.append({
                "id": m.get("id"),
                "name": m.get("name") or m.get("title") or "Мастер",
                "isActive": bool(m.get("isActive", m.get("active", True))),
                "bio": m.get("bio") or m.get("description") or "",
                "style": m.get("style") or "",
                "photoUrl": m.get("photoUrl") or m.get("imageUrl") or m.get("avatar"),
            })
        return out
    except Exception as e:
        log.warning("masters fetch failed: %s", e)
        return []

def safe_get_bookings():
    try:
        data = api_get("/api/bookings")
        return data.get("bookings", []) if isinstance(data, dict) else []
    except Exception as e:
        log.warning("bookings fetch failed: %s", e)
        return []

def safe_create_booking(payload):
    try:
        return api_post("/api/bookings", payload)
    except Exception as e:
        log.warning("booking create failed: %s", e)
        return None

def money(v: int) -> str:
    try:
        return f"{int(v):,}".replace(",", " ") + " ₽"
    except:
        return str(v)

def has_future_booking_for_user(user_id: int) -> bool:
    now = datetime.now(tz=TZ)
    for b in safe_get_bookings():
        uid = b.get("userId") or b.get("telegramId")
        status = (b.get("status") or "").lower()
        # считаем активными все, что не canceled/done
        if uid == user_id and status not in ("canceled", "cancelled", "done", "completed"):
            dt = b.get("dateTime") or b.get("start") or b.get("date")
            try:
                t = datetime.fromisoformat(dt.replace("Z","+00:00") if "Z" in str(dt) else dt)
                if t.tzinfo is None: t = t.replace(tzinfo=TZ)
                if t >= now:
                    return True
            except: pass
    return False

# ===== ui =====
def kb_main():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("🗓 Записаться", callback_data="book")],
        [InlineKeyboardButton("🧭 Как добраться", callback_data="route"),
         InlineKeyboardButton("👥 О мастерах", callback_data="about")],
        [InlineKeyboardButton("🖼 Портфолио", callback_data="portfolio"),
         InlineKeyboardButton("📜 Сертификаты", callback_data="certs")],
        [InlineKeyboardButton("💳 Оплата", callback_data="pay")],
    ])

def kb_back_home():
    return InlineKeyboardMarkup([[InlineKeyboardButton("↩️ Назад", callback_data="home")]])

# ===== conversation states =====
(
    S_CAPTCHA,     # капча при первом входе
    S_SVC,         # выбор услуги
    S_DATE,        # выбор даты
    S_TIME,        # выбор времени
    S_MASTER,      # выбор мастера
    S_NAME,        # ввод имени
    S_PHONE,       # ввод телефона
) = range(7)

verified = set()
captcha = {}

# ===== /start + captcha =====
def cmd_start(update, ctx: CallbackContext):
    uid = update.effective_user.id
    if uid not in verified:
        a,b = random.randint(1,9), random.randint(1,9)
        captcha[uid]=(a,b)
        update.message.reply_text(
            f"Привет! Для защиты от спама реши капчу: *{a}+{b}* = ?",
            parse_mode=ParseMode.MARKDOWN
        )
        return S_CAPTCHA
    send_home_text(update, ctx)
    return ConversationHandler.END

def on_captcha(update, ctx: CallbackContext):
    uid = update.effective_user.id
    ans = update.message.text.strip()
    a,b = captcha.get(uid,(None,None))
    if a is None: return ConversationHandler.END
    if ans.isdigit() and int(ans)==a+b:
        verified.add(uid); captcha.pop(uid,None)
        send_home_text(update, ctx)
        return ConversationHandler.END
    update.message.reply_text("Неа. Пришли число ещё раз.")
    return S_CAPTCHA

def send_home_text(update_or_query, ctx: CallbackContext):
    s = safe_get_settings()
    intro = s.get("welcomeText") or (
        "👋 Привет! Я бот тату-студии.\n"
        "• Запись в пару кликов\n• Напомню о визите\n• Покажу маршрут до студии\n"
        "• Расскажу о мастерах, портфолио и сертификатах\n\nРаботаю 24/7."
    )
    if getattr(update_or_query, "message", None):
        update_or_query.message.reply_text(intro, parse_mode=ParseMode.MARKDOWN, reply_markup=kb_main())
    else:
        update_or_query.callback_query.edit_message_text(intro, parse_mode=ParseMode.MARKDOWN, reply_markup=kb_main())

# ===== entry for booking is INSIDE ConversationHandler =====
def entry_book(update, ctx: CallbackContext):
    q = update.callback_query
    q.answer()

    # запрет на множественные записи
    uid = q.from_user.id
    if has_future_booking_for_user(uid):
        q.edit_message_text(
            "У тебя уже есть активная запись. Если нужно изменить время — напиши администратору или дождись завершения визита.",
            reply_markup=kb_back_home()
        )
        return ConversationHandler.END

    services = safe_get_services()
    if not services:
        q.edit_message_text("Нет доступных услуг. Попробуйте позже.", reply_markup=kb_back_home())
        return ConversationHandler.END

    ctx.user_data.clear()
    ctx.user_data["services"] = {str(s["id"]): s for s in services}
    kb = [[InlineKeyboardButton(f"{s['name']} • {money(s['price'])}", callback_data=f"svc:{s['id']}")] for s in services[:30]]
    kb.append([InlineKeyboardButton("↩️ Назад", callback_data="home")])
    q.edit_message_text("Выбери услугу:", reply_markup=InlineKeyboardMarkup(kb))
    return S_SVC

def pick_service(update, ctx: CallbackContext):
    q = update.callback_query; q.answer()
    _, sid = q.data.split(":",1)
    ctx.user_data["svc_id"]=sid
    svc = ctx.user_data["services"].get(sid,{})
    dur = int(svc.get("duration",60))

    # 30 дней вперёд, русские дни недели
    today = date.today()
    days = [today + timedelta(days=i) for i in range(30)]
    rows,row=[],[]
    for i,d in enumerate(days,1):
        dow = RU_DOW[d.weekday()]
        rowsel = InlineKeyboardButton(d.strftime(f"%d.%m ({dow})"), callback_data=f"d:{d.isoformat()}")
        row.append(rowsel)
        if i%3==0: rows.append(row); row=[]
    if row: rows.append(row)
    rows.append([InlineKeyboardButton("↩️ Назад", callback_data="book")])

    q.edit_message_text(
        f"Услуга: *{svc.get('name','Услуга')}*\nДлительность: {dur} мин\n\nВыбери дату:",
        parse_mode=ParseMode.MARKDOWN,
        reply_markup=InlineKeyboardMarkup(rows)
    )
    return S_DATE

def pick_date(update, ctx: CallbackContext):
    q = update.callback_query; q.answer()
    _, ds = q.data.split(":",1)
    ctx.user_data["date"]=ds
    svc = ctx.user_data["services"].get(ctx.user_data["svc_id"],{})
    dur = int(svc.get("duration",60))

    # занято:
    taken=set()
    for b in safe_get_bookings():
        dt = b.get("dateTime") or b.get("start") or b.get("date")
        try:
            t = datetime.fromisoformat(dt.replace("Z","+00:00") if "Z" in str(dt) else dt)
            if t.tzinfo is None: t = t.replace(tzinfo=TZ)
            t = t.astimezone(TZ)
            taken.add(t.strftime("%H:%M"))
        except: pass

    base = datetime.combine(datetime.fromisoformat(ds).date(), dtime(10,0), tzinfo=TZ)
    end  = datetime.combine(datetime.fromisoformat(ds).date(), dtime(20,0), tzinfo=TZ)

    slots=[]; cur=base
    while cur+timedelta(minutes=dur) <= end:
        label=cur.strftime("%H:%M")
        if label not in taken: slots.append(label)
        cur+=timedelta(minutes=dur)

    if not slots:
        q.edit_message_text("Свободных слотов нет. Выбери другую дату.", reply_markup=kb_back_home())
        return S_TIME

    rows,row=[],[]
    for i,s in enumerate(slots,1):
        row.append(InlineKeyboardButton(s, callback_data=f"t:{s}"))
        if i%4==0: rows.append(row); row=[]
    if row: rows.append(row)
    rows.append([InlineKeyboardButton("↩️ Назад", callback_data=f"svc:{ctx.user_data['svc_id']}")])

    q.edit_message_text("Выбери время:", reply_markup=InlineKeyboardMarkup(rows))
    return S_TIME

def pick_time(update, ctx: CallbackContext):
    q = update.callback_query; q.answer()
    _, ts = q.data.split(":",1)
    ctx.user_data["time"]=ts

    # выбрать мастера (только активных)
    masters = [m for m in safe_get_masters() if m.get("isActive", True)]
    if not masters:
        q.edit_message_text("Пока нет активных мастеров. Попробуй позже.", reply_markup=kb_back_home())
        return ConversationHandler.END

    ctx.user_data["masters"] = {str(m["id"]): m for m in masters if m.get("id")}
    rows=[]
    for m in masters[:25]:
        label = m["name"]
        if m.get("style"): label += f" • {m['style']}"
        rows.append([InlineKeyboardButton(label, callback_data=f"m:{m['id']}")])
    rows.append([InlineKeyboardButton("↩️ Назад", callback_data=f"d:{ctx.user_data['date']}")])
    q.edit_message_text("К кому записаться?", reply_markup=InlineKeyboardMarkup(rows))
    return S_MASTER

def pick_master(update, ctx: CallbackContext):
    q = update.callback_query; q.answer()
    _, mid = q.data.split(":",1)
    ctx.user_data["master_id"]=mid
    # спрашиваем имя
    q.edit_message_text(
        "Как к тебе обращаться? Напиши имя (можно просто как тебя обычно называют).",
        reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("↩️ Назад", callback_data=f"t:{ctx.user_data['time']}")]])
    )
    return S_NAME

def ask_phone(update, ctx: CallbackContext):
    name = update.message.text.strip()
    if not name or len(name)<2:
        update.message.reply_text("Имя слишком короткое. Пришли нормальное имя 🙂")
        return S_NAME
    ctx.user_data["customer_name"]=name
    update.message.reply_text(
        "Огонь! А теперь номер телефона для связи (в любом формате, можно +7... или 8...).",
    )
    return S_PHONE

PHONE_RX = re.compile(r"^\+?\d[\d \-\(\)]{8,}$")

def finalize_booking(update, ctx: CallbackContext):
    phone = update.message.text.strip()
    if not PHONE_RX.match(phone):
        update.message.reply_text("Кажется, это не похоже на номер. Пришли номер в формате +7XXXXXXXXXX.")
        return S_PHONE

    # финальный payload
    ds = ctx.user_data["date"]
    ts = ctx.user_data["time"]
    dt_iso = f"{ds}T{ts}:00"

    svc = ctx.user_data["services"].get(ctx.user_data["svc_id"],{})
    payload = {
        "serviceId": ctx.user_data["svc_id"],
        "masterId": ctx.user_data.get("master_id"),
        "dateTime": dt_iso,
        "customerName": ctx.user_data.get("customer_name"),
        "name": ctx.user_data.get("customer_name"),
        "phone": phone,
        "username": update.effective_user.username,
        "userId": update.effective_user.id,
    }

    created = safe_create_booking(payload)
    if not created:
        update.message.reply_text(
            "Не удалось подтвердить запись (возможно, слот успели занять). Попробуй другое время.",
            reply_markup=kb_back_home()
        )
        return ConversationHandler.END

    s = safe_get_settings()
    address = s.get("address","Адрес уточним в чате")
    when = datetime.fromisoformat(dt_iso).astimezone(TZ).strftime("%d.%m.%Y • %H:%M")
    txt = (
        "✅ *Запись подтверждена!*\n\n"
        f"*Услуга:* {svc.get('name','Услуга')}\n"
        f"*Мастер:* { (ctx.user_data.get('masters',{}).get(ctx.user_data.get('master_id'),{}).get('name')) or 'Любой'}\n"
        f"*Дата и время:* {when}\n"
        f"*Адрес:* {address}\n\n"
        "До встречи! Напоминание прилетит заранее."
    )
    update.message.reply_text(txt, parse_mode=ParseMode.MARKDOWN, reply_markup=kb_back_home())
    return ConversationHandler.END

# ===== generic buttons out of conversation =====
def btn(update, ctx: CallbackContext):
    q = update.callback_query
    q.answer()
    data = q.data

    if data == "home":
        send_home_text(update, ctx)
        return

    if data == "route":
        s = safe_get_settings()
        address = s.get("address", "Адрес не указан")

        # поддержим разные ключи координат
        lat = s.get("lat") or s.get("latitude")
        lon = s.get("lng") or s.get("lon") or s.get("longitude")

        # в строках — тоже ок
        try:
            if isinstance(lat, str):
                lat = lat.strip()
            if isinstance(lon, str):
                lon = lon.strip()
        except:
            pass

        parts = [f"📍 *Адрес:* {address}"]

        if lat and lon:
            yan_link = f"https://yandex.ru/maps/?pt={lon},{lat}&z=16&l=map"
            goo_link = f"https://maps.google.com/?q={lat},{lon}"
            parts.append(f"[Открыть в Яндекс.Картах]({yan_link})")
            parts.append(f"[Открыть в Google Maps]({goo_link})")

            # 1) присылаем статичную карту (сначала Яндекс без ключа, потом OSM)
            static_candidates = [
                f"https://static-maps.yandex.ru/1.x/?ll={lon},{lat}&z=16&l=map&size=650,300&pt={lon},{lat},pm2blm&lang=ru_RU",
                f"https://staticmap.openstreetmap.de/staticmap.php?center={lat},{lon}&zoom=16&size=650x300&markers={lat},{lon}",
            ]
            sent_any = False
            for url in static_candidates:
                try:
                    q.message.bot.send_photo(chat_id=q.message.chat_id, photo=url)
                    sent_any = True
                    break
                except Exception as e:
                    log.debug("static map try failed: %s", e)

            # 2) присылаем геолокацию TG (даже если картинка не пришла)
            try:
                q.message.bot.send_location(
                    chat_id=q.message.chat_id,
                    latitude=float(lat),
                    longitude=float(lon),
                )
                sent_any = True
            except Exception as e:
                log.debug("send_location failed: %s", e)

        # 3) И ТОЛЬКО ПОСЛЕ КАРТ/ГЕО — отправляем НОВОЕ сообщение с текстом и кнопкой снизу
        q.message.bot.send_message(
            chat_id=q.message.chat_id,
            text="\n".join(parts),
            parse_mode=ParseMode.MARKDOWN,
            reply_markup=kb_back_home(),
        )
        return

    if data=="about":
        # список мастеров
        masters = safe_get_masters()
        active = [m for m in masters if m.get("isActive", True)]
        if not active:
            q.edit_message_text("Пока нет активных мастеров.", reply_markup=kb_back_home()); return
        # шлём по одному
        for m in active[:10]:
            caption = f"*{m['name']}*"
            if m.get("style"): caption += f"\nСтиль: {m['style']}"
            if m.get("bio"): caption += f"\n{m['bio']}"
            if m.get("photoUrl"):
                try:
                    q.message.bot.send_photo(chat_id=q.message.chat_id, photo=m["photoUrl"], caption=caption, parse_mode=ParseMode.MARKDOWN)
                except:
                    q.message.bot.send_message(chat_id=q.message.chat_id, text=caption, parse_mode=ParseMode.MARKDOWN)
            else:
                q.message.bot.send_message(chat_id=q.message.chat_id, text=caption, parse_mode=ParseMode.MARKDOWN)
        q.message.reply_text("Это наши мастера 👆", reply_markup=kb_back_home()); return

    if data=="certs":
        s = safe_get_settings()
        links = [x.strip() for x in (s.get("certificates") or "").split(",") if x.strip()]
        if links:
            media = [InputMediaPhoto(u) for u in links[:10]]
            try: q.message.bot.send_media_group(chat_id=q.message.chat_id, media=media)
            except Exception as e: log.debug("certs media group failed: %s", e)
            q.message.reply_text("Сертификаты", reply_markup=kb_back_home())
        else:
            q.edit_message_text("Сертификаты пока не загружены.", reply_markup=kb_back_home())
        return

    if data=="pay":
        s = safe_get_settings()
        pay = s.get("paymentInfo") or (
            "💳 *Оплата*\n\n"
            "• Наличные в студии\n"
            "• СБП (по номеру телефона)\n"
            "• Банковские карты\n"
            "• Криптовалюта (по запросу)\n\n"
            "_Депозит фиксирует слот и вычитается из стоимости сеанса._"
        )
        q.edit_message_text(pay, parse_mode=ParseMode.MARKDOWN, reply_markup=kb_back_home()); return

    if data=="portfolio":
        items = safe_get_portfolio()
        if items:
            media=[]
            for it in items[:5]:
                if it["image"]: media.append(InputMediaPhoto(media=it["image"], caption=it.get("caption") or None))
            if media:
                try: q.message.bot.send_media_group(chat_id=q.message.chat_id, media=media)
                except Exception as e: log.debug("portfolio media group failed: %s", e)
            q.message.reply_text("Портфолио", reply_markup=kb_back_home())
        else:
            q.edit_message_text("Портфолио пока пусто.", reply_markup=kb_back_home())
        return

def cmd_ping(u, c): u.message.reply_text("pong")

def main():
    if not TOKEN:
        log.error("TELEGRAM_BOT_TOKEN is empty – set token in admin.")
        while True: time.sleep(30)

    upd = Updater(TOKEN, use_context=True)
    dp = upd.dispatcher

    conv = ConversationHandler(
        entry_points=[
            CommandHandler("start", cmd_start),
            CallbackQueryHandler(entry_book, pattern=r"^book$"),
        ],
        states={
            S_CAPTCHA: [MessageHandler(Filters.text & ~Filters.command, on_captcha)],
            S_SVC:     [CallbackQueryHandler(pick_service, pattern=r"^svc:.+")],
            S_DATE:    [CallbackQueryHandler(pick_date,    pattern=r"^d:.+")],
            S_TIME:    [CallbackQueryHandler(pick_time,    pattern=r"^t:.+")],
            S_MASTER:  [CallbackQueryHandler(pick_master,  pattern=r"^m:.+")],
            S_NAME:    [MessageHandler(Filters.text & ~Filters.command, ask_phone)],
            S_PHONE:   [MessageHandler(Filters.text & ~Filters.command, finalize_booking)],
        },
        fallbacks=[CallbackQueryHandler(btn)],
        allow_reentry=True
    )

    dp.add_handler(conv)
    dp.add_handler(CallbackQueryHandler(btn))
    dp.add_handler(CommandHandler("ping", cmd_ping))

    log.info("Bot starting polling...")
    upd.start_polling()
    upd.idle()

if __name__ == "__main__":
    main()
