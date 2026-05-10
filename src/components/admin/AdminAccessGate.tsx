"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminAccessGate() {
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function unlockArea() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/admin/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Não foi possível liberar a área administrativa.");
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível liberar a área administrativa.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card admin-lock-card">
      <label>
        <span>Chave privada do painel</span>
        <input
          type="password"
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          placeholder="Digite sua chave de acesso"
        />
      </label>
      <button className="btn btn-primary btn-full" onClick={unlockArea} disabled={loading || !secret.trim()}>
        {loading ? "Liberando..." : "Entrar na área administrativa"}
      </button>
      {error && <p className="notice-error">{error}</p>}
    </div>
  );
}
