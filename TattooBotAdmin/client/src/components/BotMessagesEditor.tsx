import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Save } from "lucide-react";
import { useEffect, useState } from "react";

interface BotMessage {
  id: string;
  key: string;
  label: string;
  value: string;
  type: "text" | "textarea";
}

interface BotMessagesEditorProps {
  messages: BotMessage[];
  onSave: (messages: BotMessage[]) => void;
}

export function BotMessagesEditor({ messages: initialMessages, onSave }: BotMessagesEditorProps) {
  const [messages, setMessages] = useState(initialMessages);

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  const handleChange = (id: string, value: string) => {
    setMessages((prev) =>
      prev.map((msg) => (msg.id === id ? { ...msg, value } : msg))
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Сообщения бота</h2>
        <Button onClick={() => onSave(messages)} data-testid="button-save-messages">
          <Save className="h-4 w-4 mr-2" />
          Сохранить изменения
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Текст сообщений</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {messages.map((message) => (
              <div key={message.id} className="space-y-2" data-testid={`message-field-${message.key}`}>
                <Label htmlFor={message.id}>{message.label}</Label>
                {message.type === "textarea" ? (
                  <Textarea
                    id={message.id}
                    value={message.value}
                    onChange={(e) => handleChange(message.id, e.target.value)}
                    rows={4}
                    data-testid={`textarea-${message.key}`}
                  />
                ) : (
                  <Input
                    id={message.id}
                    value={message.value}
                    onChange={(e) => handleChange(message.id, e.target.value)}
                    data-testid={`input-${message.key}`}
                  />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
