import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useDBQuery, dbExec } from '@/hooks/useDB';
import type { Todo } from '@/db';

function Todos() {
  const [newTitle, setNewTitle] = useState('');
  const { rows: todos, loading, error, refetch } = useDBQuery<Todo>(
    'SELECT * FROM todos ORDER BY created_at DESC',
  );

  const addTodo = async () => {
    const title = newTitle.trim();
    if (!title) return;
    await dbExec(`INSERT INTO todos (title) VALUES ('${title.replace(/'/g, "''")}')`);
    setNewTitle('');
    refetch();
  };

  const toggleTodo = async (id: number, completed: boolean) => {
    await dbExec(`UPDATE todos SET completed = ${!completed} WHERE id = ${id}`);
    refetch();
  };

  const deleteTodo = async (id: number) => {
    await dbExec(`DELETE FROM todos WHERE id = ${id}`);
    refetch();
  };

  return (
    <main className="min-h-screen bg-transparent text-foreground">
      <nav className="mx-auto flex w-full max-w-6xl items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <Link to="/" className="text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors">Home</Link>
        <Link to="/about" className="text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors">About</Link>
        <Link to="/todos" className="text-sm font-semibold text-foreground hover:text-foreground/80 transition-colors">Todos</Link>
      </nav>

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <section className="rounded-[2rem] border border-border/60 bg-background/82 p-6 shadow-[0_40px_120px_-40px_rgba(15,23,42,0.65)] backdrop-blur-xl sm:p-8">
          <div className="space-y-6">
            <div className="space-y-2">
              <span className="inline-flex w-fit items-center rounded-full border border-border/60 bg-secondary/70 px-3 py-1 font-mono text-[0.72rem] uppercase tracking-[0.28em] text-muted-foreground">
                PGlite + Drizzle
              </span>
              <h1 className="text-3xl font-semibold tracking-tight">Todos</h1>
            </div>

            <form
              onSubmit={(e) => { e.preventDefault(); addTodo(); }}
              className="flex gap-3"
            >
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="What needs to be done?"
                className="flex-1 rounded-xl border border-input bg-card/70 px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
              />
              <Button type="submit" disabled={!newTitle.trim()}>
                Add
              </Button>
            </form>

            {error && (
              <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {loading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : todos.length === 0 ? (
              <p className="text-sm text-muted-foreground">No todos yet. Add one above.</p>
            ) : (
              <ul className="space-y-2">
                {todos.map((todo) => (
                  <li
                    key={todo.id}
                    className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/75 px-4 py-3"
                  >
                    <button
                      onClick={() => toggleTodo(todo.id, todo.completed)}
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                        todo.completed
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-input hover:border-primary/60'
                      }`}
                    >
                      {todo.completed && (
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                    <span className={`flex-1 text-sm ${todo.completed ? 'text-muted-foreground line-through' : ''}`}>
                      {todo.title}
                    </span>
                    <button
                      onClick={() => deleteTodo(todo.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                      title="Delete"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {todos.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {todos.filter((t) => !t.completed).length} remaining &middot;{' '}
                {todos.filter((t) => t.completed).length} completed
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

export default Todos;
