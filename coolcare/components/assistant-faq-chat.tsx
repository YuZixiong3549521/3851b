'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUp, Bot, CalendarPlus, Mail, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { answerAssistantQuestion, assistantQuestions, type AssistantAnswer, type AssistantQuestionId } from '@/lib/assistant-faq';
import { answerAssistantMessage, ASSISTANT_MESSAGE_LIMIT } from '@/lib/assistant-intents';
import type { BookingOptions } from '@/lib/coolcare-types';

type Exchange = AssistantAnswer & { id: number; suggestions?: AssistantQuestionId[] };
const quickQuestions: AssistantQuestionId[] = ['prices', 'dates', 'annual', 'points'];

export function AssistantFaqChat({ firstName, options, active, bookingDisabled, hasDraft, onBooking, supportHref }: {
  firstName: string;
  options: BookingOptions | null;
  active: boolean;
  bookingDisabled: boolean;
  hasDraft: boolean;
  onBooking: () => void;
  supportHref: string;
}) {
  const [questionId, setQuestionId] = useState<AssistantQuestionId | ''>('');
  const [message, setMessage] = useState('');
  const [faqOpen, setFaqOpen] = useState(false);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const id = useId();
  const nextId = useRef(0);
  const log = useRef<HTMLDivElement>(null);
  const latest = exchanges[exchanges.length - 1];
  useEffect(() => { if (active && log.current) log.current.scrollTo({ top: log.current.scrollHeight }); }, [active, exchanges.length, latest?.id]);

  function reply(answer: AssistantAnswer & { suggestions?: AssistantQuestionId[] }) {
    // Questions are a lightweight in-memory conversation, separate from durable booking drafts.
    setExchanges(current => [...current.slice(-11), { ...answer, id: ++nextId.current }]);
  }
  function ask(value: AssistantQuestionId) {
    reply(answerAssistantQuestion(value, options));
    setQuestionId('');
  }
  function send() {
    if (!message.trim()) return;
    reply(answerAssistantMessage(message, options));
    setMessage('');
  }
  return <div hidden={!active} className={active ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
    <div ref={log} className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-muted/45 px-4 py-5" role="log" aria-label="Assistant conversation" aria-live="polite" aria-relevant="additions">
      <div className="flex items-start gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground"><Bot className="size-4" aria-hidden="true" /></span>
        <div className="min-w-0 max-w-[calc(100%-2.75rem)] space-y-3 rounded-2xl rounded-tl-sm border bg-card p-4 text-sm leading-6 shadow-xs">
          <p className="font-semibold">Hi {firstName}, how can I help?</p>
          <p>Type a question or keyword, such as price, booking dates or loyalty points. You can also choose a common question below.</p>
          <Button className="h-auto w-full whitespace-normal" onClick={onBooking} disabled={bookingDisabled}><CalendarPlus className="size-4 shrink-0" />{hasDraft ? 'Continue my booking' : 'Book a service'}</Button>
          <p className="text-xs leading-5 text-muted-foreground">Your booking draft stays saved separately. Questions do not change your booking answers.</p>
        </div>
      </div>
      <div className="ml-10.5 flex flex-wrap gap-2" aria-label="Popular questions">{quickQuestions.map(value => {
        const item = assistantQuestions.find(question => question.id === value)!;
        return <Button key={value} variant="outline" size="sm" className="h-auto rounded-full bg-card px-3 py-2 text-xs" onClick={() => ask(value)}>{item.short}</Button>;
      })}</div>
      {exchanges.map(exchange => <div key={exchange.id} className="space-y-4">
        <div className="ml-10 flex justify-end"><p className="max-w-full whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground [overflow-wrap:anywhere]"><span className="sr-only">You: </span>{exchange.question}</p></div>
        <div className="flex items-start gap-2.5"><span className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground"><Bot className="size-4" aria-hidden="true" /></span><div className="min-w-0 max-w-[calc(100%-2.75rem)] space-y-3 rounded-2xl rounded-tl-sm border bg-card p-4 text-sm leading-6 shadow-xs"><span className="sr-only">CoolCare Assistant: </span>{exchange.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}{!!exchange.suggestions?.length && <div className="flex flex-wrap gap-2" aria-label="Suggested topics">{exchange.suggestions.map(value => <Button key={value} variant="outline" size="sm" className="h-auto whitespace-normal text-left" onClick={() => ask(value)}>{assistantQuestions.find(question => question.id === value)!.short}</Button>)}</div>}{exchange.action === 'booking' && <Button variant="outline" size="sm" className="h-auto whitespace-normal" disabled={bookingDisabled} onClick={onBooking}><CalendarPlus className="size-4 shrink-0" />{hasDraft ? 'Continue booking' : 'Start a booking'}</Button>}{exchange.action === 'support' && <a className="inline-flex items-center gap-2 font-medium text-primary underline underline-offset-4" href={supportHref}><Mail className="size-4" />Email support</a>}</div></div>
      </div>)}
    </div>
    <div className="max-h-[45%] shrink-0 space-y-3 overflow-y-auto border-t bg-background px-4 py-3">
      <details open={faqOpen} onToggle={event => setFaqOpen(event.currentTarget.open)}>
        <summary className="w-fit cursor-pointer rounded-sm text-xs font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><MessageCircle className="mr-1.5 inline size-3.5" aria-hidden="true" />Common questions</summary>
        <form className="mt-2 flex items-end gap-2" onSubmit={event => { event.preventDefault(); if (questionId) ask(questionId); }}>
          <label htmlFor={id + '-faq'} className="sr-only">Frequently asked questions</label>
          <NativeSelect id={id + '-faq'} value={questionId} onChange={event => setQuestionId(event.target.value as AssistantQuestionId)} wrapperClassName="min-w-0 flex-1" className="h-10 rounded-xl"><option value="">Choose a question…</option>{[...new Set(assistantQuestions.map(question => question.group))].map(group => <optgroup label={group} key={group}>{assistantQuestions.filter(question => question.group === group).map(question => <option key={question.id} value={question.id}>{question.question}</option>)}</optgroup>)}</NativeSelect><Button type="submit" size="icon" variant="outline" className="size-10 shrink-0 rounded-xl" disabled={!questionId} aria-label="Ask selected question"><ArrowUp className="size-4" /></Button>
        </form>
      </details>
      <form onSubmit={event => { event.preventDefault(); send(); }}>
        <label htmlFor={id + '-message'} className="sr-only">Message CoolCare</label>
        <div className="flex items-end gap-2"><Textarea id={id + '-message'} rows={2} value={message} maxLength={ASSISTANT_MESSAGE_LIMIT} onFocus={() => setFaqOpen(false)} onChange={event => setMessage(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); send(); } }} placeholder="Type a question or keyword…" className="max-h-[min(112px,20dvh)] min-h-12 resize-none rounded-xl bg-muted/30 px-3 py-2.5" aria-describedby={id + '-hint'} enterKeyHint="send" /><Button type="submit" size="icon" className="size-11 shrink-0 rounded-full" disabled={!message.trim()} aria-label="Send message"><ArrowUp className="size-5" /></Button></div>
        <div id={id + '-hint'} className="mt-2 flex justify-between gap-2 text-[11px] leading-4 text-muted-foreground"><p>Answers about CoolCare services · Enter to send</p>{message.length >= 400 && <span className="shrink-0">{message.length}/{ASSISTANT_MESSAGE_LIMIT}</span>}</div>
      </form>
    </div>
  </div>;
}
