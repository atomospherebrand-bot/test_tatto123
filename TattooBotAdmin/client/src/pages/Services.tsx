import { ServicesList } from "@/components/ServicesList";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export default function Services() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const servicesQuery = useQuery({
    queryKey: ["services"],
    queryFn: () => api.getServices(),
  });

  const createMutation = useMutation({
    mutationFn: api.createService,
    onSuccess: () => {
      toast({ title: "Услуга создана" });
      queryClient.invalidateQueries({ queryKey: ["services"] });
    },
    onError: (error: Error) => {
      toast({ title: "Не удалось создать услугу", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: Record<string, unknown> }) =>
      api.updateService(id, values),
    onSuccess: () => {
      toast({ title: "Услуга обновлена" });
      queryClient.invalidateQueries({ queryKey: ["services"] });
    },
    onError: (error: Error) => {
      toast({ title: "Не удалось обновить услугу", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteService,
    onSuccess: () => {
      toast({ title: "Услуга удалена" });
      queryClient.invalidateQueries({ queryKey: ["services"] });
    },
    onError: (error: Error) => {
      toast({ title: "Не удалось удалить услугу", description: error.message, variant: "destructive" });
    },
  });

  const handleAdd = () => {
    const name = window.prompt("Название услуги", "");
    if (!name) return;
    const duration = Number(window.prompt("Длительность (мин)", "60") ?? 0);
    if (!Number.isFinite(duration) || duration <= 0) {
      toast({ title: "Неверная длительность", variant: "destructive" });
      return;
    }
    const price = Number(window.prompt("Стоимость (₽)", "0") ?? 0);
    if (!Number.isFinite(price) || price < 0) {
      toast({ title: "Неверная стоимость", variant: "destructive" });
      return;
    }
    const description = window.prompt("Описание", "") ?? "";

    createMutation.mutate({ name, duration, price, description });
  };

  const handleEdit = (id: string) => {
    if (!servicesQuery.data) return;
    const service = servicesQuery.data.find((item) => item.id === id);
    if (!service) return;

    const name = window.prompt("Название услуги", service.name) ?? service.name;
    if (!name) return;
    const duration = Number(window.prompt("Длительность (мин)", String(service.duration)) ?? service.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      toast({ title: "Неверная длительность", variant: "destructive" });
      return;
    }
    const price = Number(window.prompt("Стоимость (₽)", String(service.price)) ?? service.price);
    if (!Number.isFinite(price) || price < 0) {
      toast({ title: "Неверная стоимость", variant: "destructive" });
      return;
    }
    const description = window.prompt("Описание", service.description ?? "") ?? service.description;

    updateMutation.mutate({ id, values: { name, duration, price, description } });
  };

  const handleDelete = (id: string) => {
    if (!window.confirm("Удалить услугу?")) return;
    deleteMutation.mutate(id);
  };

  if (servicesQuery.isLoading) {
    return <p>Загрузка услуг…</p>;
  }

  if (servicesQuery.isError) {
    return <p className="text-destructive">Не удалось загрузить услуги</p>;
  }

  return (
    <ServicesList
      services={servicesQuery.data ?? []}
      onEdit={handleEdit}
      onDelete={handleDelete}
      onAdd={handleAdd}
    />
  );
}
