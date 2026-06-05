import type { TraceEvent } from "@kazeds/shared";
import { TRACE_MAX_EVENTS } from "@kazeds/shared";

/**
 * TraceStore — кольцевой буфер trace-событий со всех компонентов.
 * Хранение только в памяти (как и сессии) — это отладочный инструмент,
 * не журнал аудита. Клиенты шлют события только когда trace включён
 * у них (kazeds_trace=1 / ?trace=true), сам приём всегда открыт.
 */
export class TraceStore {
  private events: TraceEvent[] = [];

  add(event: TraceEvent): void {
    this.events.push({ ...event, received_at: new Date().toISOString() });
    if (this.events.length > TRACE_MAX_EVENTS) {
      this.events.splice(0, this.events.length - TRACE_MAX_EVENTS);
    }
  }

  addBatch(events: TraceEvent[]): number {
    for (const e of events) this.add(e);
    return events.length;
  }

  /** Последние события; фильтр по session_id и/или source */
  list(opts: { session_id?: string; source?: string; limit?: number } = {}): TraceEvent[] {
    let out = this.events;
    if (opts.session_id) out = out.filter((e) => e.session_id === opts.session_id);
    if (opts.source) out = out.filter((e) => e.source === opts.source);
    const limit = Math.min(opts.limit ?? 500, TRACE_MAX_EVENTS);
    return out.slice(-limit);
  }

  clear(): void {
    this.events = [];
  }

  get size(): number {
    return this.events.length;
  }
}
