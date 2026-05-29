import { useEffect, useState } from "react";
import { Link, Route, Routes } from "react-router-dom";

function Home() {
  const [message, setMessage] = useState<string>("loading...");

  useEffect(() => {
    fetch("/api/hello")
      .then((r) => r.json())
      .then((data: { message: string }) => setMessage(data.message))
      .catch(() => setMessage("backend unreachable"));
  }, []);

  return (
    <section>
      <h1>Helpdesk</h1>
      <p>Backend says: {message}</p>
    </section>
  );
}

function Tickets() {
  return (
    <section>
      <h1>Tickets</h1>
      <p>Placeholder for the ticket list.</p>
    </section>
  );
}

export default function App() {
  return (
    <div>
      <nav style={{ display: "flex", gap: "1rem", padding: "1rem" }}>
        <Link to="/">Home</Link>
        <Link to="/tickets">Tickets</Link>
      </nav>
      <main style={{ padding: "1rem" }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/tickets" element={<Tickets />} />
        </Routes>
      </main>
    </div>
  );
}
