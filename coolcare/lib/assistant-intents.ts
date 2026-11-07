import type { BookingOptions } from './coolcare-types';
import { answerAssistantQuestion, type AssistantAnswer, type AssistantQuestionId } from './assistant-faq';

export const ASSISTANT_MESSAGE_LIMIT = 500;
export type AssistantMessageAnswer = AssistantAnswer & { suggestions?: AssistantQuestionId[] };

/** Keyword matching selects reviewed guidance only. It never reads or changes an order. */
export function answerAssistantMessage(input: string, options: BookingOptions | null): AssistantMessageAnswer {
  const trimmed = input.trim();
  const question = trimmed.slice(0, ASSISTANT_MESSAGE_LIMIT);
  const reply = (paragraphs: string[], suggestions?: AssistantQuestionId[], action?: AssistantAnswer['action']): AssistantMessageAnswer =>
    ({ question, paragraphs, ...(suggestions ? { suggestions } : {}), ...(action ? { action } : {}) });
  if (!trimmed) return reply(['Type a question or a keyword, such as price, booking dates, reschedule or points.'], ['prices', 'dates', 'points']);
  if (trimmed.length > ASSISTANT_MESSAGE_LIMIT) return reply([`Please keep your question to ${ASSISTANT_MESSAGE_LIMIT} characters or fewer and ask about one topic at a time.`]);

  const text = trimmed.normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").replace(/[-–—_/]/g, ' ').replace(/\s+/g, ' ');
  const has = (pattern: RegExp) => pattern.test(text);
  const noBooking = has(/\b(?:do not|don't|dont|not ready to|not looking to|no need to)\s+(?:want to\s+)?(?:book|reserve)\b|不想预约|不要预约|不用预约|不要下单|不想下单/);
  const noCancellation = has(/\b(?:do not|don't|dont|not looking to)\s+(?:want to\s+)?cancel\b|不要取消|不想取消|不用取消/);
  const answer = (id: AssistantQuestionId): AssistantMessageAnswer => {
    const result = { ...answerAssistantQuestion(id, options), question };
    if (noBooking && result.action === 'booking') delete result.action;
    return result;
  };
  const immediate = has(/\b(?:immediately|immediate|automatically|automatic|instantly)\b|立即|自动确认/);

  if (has(/\b(?:my|current|available)\s+(?:points?\s+)?balance\b|\bhow many points? (?:do i have|have i got)\b|积分余额|多少积分/)) {
    return reply(['Open My Rewards to see your current points balance and activity. This chat explains reward rules but does not look up your balance.'], ['points', 'returned-points']);
  }
  const personalStatus = !immediate && has(/\b(?:my|this|our)\s+(?:booking|order|appointment)\s+(?:(?:is|has been|was)\s+)?(?:status|confirmed|assigned|completed|rejected|cancelled|canceled)\b|\b(?:status|history|track|find|show|check)\s+(?:of\s+)?(?:my|this|our)\s+(?:booking|order|appointment)s?\b|\bwhere is (?:my|the) technician\b|\bbk\s+\d{4}\s+\d+\b|我的订单|查询订单|预约记录|订单状态/);
  if (personalStatus) return reply(['Open My Bookings for the latest status of your own requests, or Booking History for completed visits and reports. This chat does not retrieve individual orders or track technicians.'], ['updates', 'confirmation', 'support']);

  const price = has(/\b(?:prices?|pricing|costs?|costing|how much|fees?|charges?|rates?|quotes?|quotation|expensive|cheaper)\b|价格|费用|多少钱|收费|报价/);
  const repair = has(/\b(?:repairs?|diagnostic|diagnosis|fix|fixing|faults?)\b|维修|修理|诊断/);
  const extras = has(/\b(?:additional|extra|extras|parts?|labou?r|surcharge|minimum|diagnostic|diagnosis)\b|额外|附加|配件|零件|最低|诊断/);
  const annual = has(/\b(?:annual|yearly|bundles?|packages?|subscriptions?|quarterly)\b|\b(?:four|4) visits?\b|年度|年费|套餐|季度|每季/);
  const points = has(/\b(?:points?|rewards?|loyalty|discounts?|redeem|redeeming|earn|earning)\b|积分|抵扣|奖励/);
  const returned = points && has(/\b(?:return(?:ed|ing)?|refund(?:ed)?|reject(?:ed|ion)?|expir(?:e[ds]?|y|ation)|releas(?:e[ds]?|ing)|lost|missing)\b|返还|退回|退还|拒绝|过期|释放|丢失/);
  const cancelPoints = points && !noCancellation && has(/\b(?:cancel(?:led|ed|ling|ing|lation)?|cancellation)\b|取消/)
    && !has(/\b(?:and|also) (?:use|redeem|earn)\b/);
  const changes = has(/\b(?:reschedul(?:e|ed|ing)|postpone|postponed)\b|\b(?:change|move|edit|modify)\s+(?:my |the |a |an )?(?:booking|appointment|visit|date|time|schedule|service address)\b|改期|更改预约|修改预约|更改时间|改时间/)
    || (!noCancellation && has(/\b(?:cancel(?:led|ed|ling|ing)?|cancellation)\b|取消/));
  const address = has(/\bsame (?:address|location|home)\b|\b(?:twice|duplicate|repeat)\s+(?:a |per |in |booking|appointment)|\b(?:two|2) bookings? (?:in|per|a) week\b|同一地址|相同地址|重复预约|一周.*两次|每周.*几次/);
  const dates = has(/\b(?:dates?|availability|available|slots?|weekends?|weekdays?|saturdays?|sundays?|tomorrow|today)\b|\b(?:when|how soon|how early|how far ahead|in advance|next week|next month|opening hours|operating hours)\b|\bwhat (?:time|day)\b|\b(?:booking|appointment|service) times?\b|\b(?:can't|cannot|unable to) book\b|预约日期|什么时候|何时|提前|周末|星期六|星期日|周六|周日|明天|今天|可用时间/);
  const email = has(/\b(?:emails?|notifications?|updates?|messages?|sms|whatsapp|status|tracking|history)\b|邮件|通知|更新|历史/);
  const support = has(/\b(?:support|contact|human|agent|phone|telephone)\b|\bcustomer service\b|\bemail address\b|\byour email\b|客服|联系|人工|联系电话/);
  const confirmation = has(/\b(?:confirm(?:ed|ation)?|approved|approval|accepted|pending|rejected|expired)\b|确认|审核|待确认|拒绝|过期/);
  const topics: AssistantQuestionId[] = [];
  if (returned || cancelPoints) topics.push('returned-points');
  else if (points) topics.push('points');
  if (repair && extras) topics.push('repair');
  else if (price) topics.push('prices');
  if (changes && !cancelPoints) topics.push('changes');
  if (address) topics.push('address');
  // Dates within a change request or an annual-price question are supporting context.
  if (dates && !changes && !address && !price) topics.push('dates');
  if (annual && !price && !changes && !returned && !cancelPoints) topics.push('annual');
  if (support) topics.push('support');
  else if (email) topics.push('updates');
  else if (confirmation && !returned && !cancelPoints) topics.push('confirmation');

  if (topics.length === 1) return answer(topics[0]);
  if (topics.length > 1) return reply(['I found more than one topic in your question. Choose the part you would like help with first, or type a shorter question.'], topics.slice(0, 3));
  if (noBooking || noCancellation) return reply(['No booking has been created or changed by this chat. You can ask a question whenever you are ready.'], ['services', 'prices', 'changes']);
  if (has(/\b(?:book|reserve)\b|\b(?:make|create|start|new)\s+(?:a |an )?(?:booking|appointment|reservation|order)\b|我要预约|想预约|新预约|预订|下单/)) {
    return reply(['I can guide you through a new booking. Open Booking to choose your service, address and preferred time, then review everything before confirming.', 'Typing here does not submit a booking or change your saved answers.'], undefined, 'booking');
  }
  if (has(/\b(?:bookings?|appointments?|reservations?)\b|预约/)) return reply(['I can help you start a booking or explain appointment dates, confirmation and changes. Choose a topic below, or open Booking to continue the guided form.', 'Questions do not create or change a booking.'], ['dates', 'confirmation', 'changes'], 'booking');
  if (repair || has(/\b(?:services?|clean(?:ing)?|chemical|regular|maintenance|leak(?:ing)?|noise|noisy)\b|\bnot cooling\b|清洗|化学|普通清洗|漏水|不制冷|噪音|服务类型/)) return answer('services');
  if (/^(?:hi|hello|hey|good (?:morning|afternoon|evening)|你好|您好)[!?.\s]*$/.test(text)) return reply(['Hi! Ask me about CoolCare prices, booking dates, annual cleaning, changes or loyalty points. You can also choose a question below.'], ['prices', 'dates', 'annual']);
  if (/^(?:thanks?(?: you)?|thank you(?: very much)?|cheers|谢谢|多谢)[!?.\s]*$/.test(text)) return reply(['You’re welcome! Type another question whenever you need help.']);
  return reply(['I could not match that question to CoolCare’s service guidance. Try a keyword such as price, booking dates, annual bundle, cancel or points, or choose a common question below.'], ['services', 'dates', 'support']);
}
