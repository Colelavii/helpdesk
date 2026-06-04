import { useEffect, useState } from "react";

export default function HomePage() {
  const [message, setMessage] = useState<string>("loading...");

  useEffect(() => {
    fetch("/api/hello")
      .then((r) => r.json())
      .then((data: { message: string }) => setMessage(data.message))
      .catch(() => setMessage("backend unreachable"));
  }, []);

  return (
    <section>
      <h1 className="text-2xl font-semibold text-gray-900">Helpdesk</h1>
      <p className="mt-2 text-gray-600">Backend says: {message}</p>
    </section>
  );
}
