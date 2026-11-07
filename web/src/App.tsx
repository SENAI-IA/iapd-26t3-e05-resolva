export function App() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
      <p className="mb-6 text-sm font-semibold tracking-widest uppercase">Resolva</p>
      <h1 className="max-w-2xl text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">
        Do relato à mudança revisável.
      </h1>
      <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
        Um espaço para conectar tickets, evidências e revisão humana em cada etapa da correção.
      </p>
      <div className="mt-12 rounded-xl border border-line bg-surface p-6">
        <h2 className="text-base font-semibold">Estamos construindo o Resolva</h2>
        <p className="mt-2 leading-relaxed text-muted">
          O cadastro de tickets, a triagem e a fila de implementação estarão disponíveis nas
          próximas entregas.
        </p>
      </div>
    </main>
  );
}
