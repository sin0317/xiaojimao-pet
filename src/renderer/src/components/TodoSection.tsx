import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { i18n, resolveLanguage } from "../../../shared/i18n";
import type { Settings } from "../../../shared/types";
import {
  composeRemindAt,
  describeRemindAt,
  pendingCount,
  splitRemindAt,
  visibleTodos,
  type TodoItem
} from "../../../shared/todos";

type Props = {
  settings: Settings;
  onToggleReminder: (enabled: boolean) => void;
};

function todayInput(): string {
  return splitRemindAt(Date.now()).date;
}

/** 默认提醒时间：下一个整点（当天已经过了 23:00 就顺延到明天 9:00） */
function defaultRemindInput(): { date: string; time: string } {
  const now = new Date();
  const next = new Date(now.getTime() + 60 * 60 * 1000);
  if (now.getHours() >= 23) {
    next.setDate(next.getDate() + 1);
    next.setHours(9, 0, 0, 0);
  } else {
    next.setMinutes(0, 0, 0);
  }
  return splitRemindAt(next.getTime());
}

export function TodoSection({ settings, onToggleReminder }: Props): JSX.Element {
  const labels = i18n(resolveLanguage(settings.language)).settings;

  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(todayInput);
  const [time, setTime] = useState(() => defaultRemindInput().time);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");

  useEffect(() => {
    let alive = true;
    void window.pawpal.listTodos().then((list) => {
      if (alive) setTodos(list);
    });
    const off = window.pawpal.onTodosChanged((list) => setTodos(list));
    return () => {
      alive = false;
      off();
    };
  }, []);

  const ordered = useMemo(() => visibleTodos(todos, Date.now()), [todos]);
  const open = pendingCount(todos);

  async function addTodo(): Promise<void> {
    const clean = title.trim();
    if (!clean) {
      setError(labels.todoNeedTitle);
      return;
    }
    const stamp = composeRemindAt(date, time);
    if (stamp === null) {
      setError(labels.todoNeedTime);
      return;
    }
    setError(null);
    await window.pawpal.createTodo(clean, stamp);
    setTitle("");
    const next = defaultRemindInput();
    setDate(next.date);
    setTime(next.time);
  }

  function beginEdit(todo: TodoItem): void {
    const parts = splitRemindAt(todo.remindAt);
    setEditingId(todo.id);
    setEditTitle(todo.title);
    setEditDate(parts.date);
    setEditTime(parts.time);
    setError(null);
  }

  async function saveEdit(id: string): Promise<void> {
    const clean = editTitle.trim();
    if (!clean) {
      setError(labels.todoNeedTitle);
      return;
    }
    const stamp = composeRemindAt(editDate, editTime);
    if (stamp === null) {
      setError(labels.todoNeedTime);
      return;
    }
    setError(null);
    await window.pawpal.updateTodo(id, { title: clean, remindAt: stamp });
    setEditingId(null);
  }

  return (
    <section className="prefs__group">
      <h2 className="prefs__group-title">
        {labels.todos}
        {open > 0 ? <span className="prefs__group-badge">{labels.todoCount(open)}</span> : null}
      </h2>

      <div className="pref-row">
        <div className="pref-row__label">
          <span>{labels.todoEnable}</span>
          <small>{labels.todoEnableHint}</small>
        </div>
        <div className="pref-row__control">
          <button
            type="button"
            className={`pref-toggle ${settings.todoReminderEnabled ? "is-on" : ""}`}
            role="switch"
            aria-checked={settings.todoReminderEnabled}
            aria-label={labels.todoEnable}
            onClick={() => onToggleReminder(!settings.todoReminderEnabled)}
          />
        </div>
      </div>

      <div className="todo-add">
        <input
          className="todo-add__title"
          value={title}
          maxLength={120}
          placeholder={labels.todoTitlePlaceholder}
          aria-label={labels.todoTitle}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void addTodo();
          }}
        />
        <input
          className="pref-time"
          type="date"
          value={date}
          aria-label={labels.todoDate}
          onChange={(event) => setDate(event.target.value)}
        />
        <input
          className="pref-time todo-add__time"
          type="time"
          value={time}
          aria-label={labels.todoTime}
          onChange={(event) => setTime(event.target.value)}
        />
        <button type="button" className="pref-button" onClick={() => void addTodo()}>
          {labels.todoAdd}
        </button>
      </div>

      {error ? <div className="todo-error">{error}</div> : null}

      <div className="todo-list">
        {ordered.length === 0 ? <div className="todo-empty">{labels.todoEmpty}</div> : null}

        {ordered.map((todo) => {
          const overdue = !todo.done && todo.remindAt <= Date.now();
          const when = describeRemindAt(todo.remindAt, Date.now(), settings.language);

          if (editingId === todo.id) {
            return (
              <div key={todo.id} className="todo-item todo-item--editing">
                <input
                  className="todo-add__title"
                  value={editTitle}
                  maxLength={120}
                  aria-label={labels.todoTitle}
                  onChange={(event) => setEditTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void saveEdit(todo.id);
                    if (event.key === "Escape") setEditingId(null);
                  }}
                />
                <input
                  className="pref-time"
                  type="date"
                  value={editDate}
                  aria-label={labels.todoDate}
                  onChange={(event) => setEditDate(event.target.value)}
                />
                <input
                  className="pref-time todo-add__time"
                  type="time"
                  value={editTime}
                  aria-label={labels.todoTime}
                  onChange={(event) => setEditTime(event.target.value)}
                />
                <div className="todo-item__actions">
                  <button
                    type="button"
                    className="pref-button"
                    onClick={() => void saveEdit(todo.id)}
                  >
                    {labels.todoSave}
                  </button>
                  <button
                    type="button"
                    className="todo-item__btn"
                    onClick={() => setEditingId(null)}
                  >
                    {labels.todoCancel}
                  </button>
                </div>
              </div>
            );
          }

          return (
            <div key={todo.id} className={`todo-item ${todo.done ? "is-done" : ""}`}>
              <input
                className="todo-item__check"
                type="checkbox"
                checked={todo.done}
                aria-label={labels.todoDoneLabel}
                onChange={(event) => void window.pawpal.toggleTodo(todo.id, event.target.checked)}
              />
              <div className="todo-item__body">
                <span className="todo-item__title">{todo.title}</span>
                <span className={`todo-item__meta ${overdue ? "is-overdue" : ""}`}>
                  {overdue && !todo.done ? `${labels.todoOverdue} · ` : ""}
                  {when}
                </span>
              </div>
              <div className="todo-item__actions">
                <button type="button" className="todo-item__btn" onClick={() => beginEdit(todo)}>
                  {labels.todoEdit}
                </button>
                <button
                  type="button"
                  className="todo-item__btn"
                  onClick={() => void window.pawpal.removeTodo(todo.id)}
                >
                  {labels.todoDelete}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
