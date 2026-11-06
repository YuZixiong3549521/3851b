import { Button } from '@/components/ui/button';
import { SiteIcon } from '@/components/ui/site-icon';
import { customerSupportEmail } from '@/lib/customer-support';
import type { PageRoute } from '../types';

export type PolicyKind = 'terms' | 'privacy';

const policyContent: Record<PolicyKind, { title: string; introduction: string; sections: { title: string; text: string }[] }> = {
  terms: {
    title: 'Terms of Service',
    introduction: 'These terms explain how to use CoolCare and how booking requests, service records and rewards work.',
    sections: [
      {
        title: 'About this installation',
        text: 'This installation is provided for university coursework and evaluation. Demonstration records describe simulated services. Use the supplied evaluation accounts or fictional details when trying the service; do not rely on a demonstration booking to arrange a real visit.',
      },
      {
        title: 'Your account',
        text: 'Create a customer account before requesting a service. Keep your sign-in details private and use only accounts you are authorised to access. Technician and administrator accounts are managed by the service team. Contact support if you cannot access your account.',
      },
      {
        title: 'Booking requests and availability',
        text: 'Choose Cleaning, Repair, both services together, or the Annual Cleaning Bundle. Provide the service address, AC count and relevant notes. New appointments must be at least 14 calendar days ahead, Monday to Friday, in Singapore time. The same customer can have at most one active cleaning appointment at the same address in a Monday–Sunday week. Your selected date and time remain a request until the service team confirms and assigns the visit.',
      },
      {
        title: 'Service amounts and rewards',
        text: 'Review the current service price before submitting. Cleaning prices depend on the AC count; the technician records the cleaning method. Repair has a minimum diagnostic fee, with any additional labour and parts charges recorded by the technician without a separate online approval step. The website does not process payments. Eligible points can be reserved when booking and are returned if that booking is cancelled, rejected or expires. Completion rewards are calculated once from the service amount after the points discount, using the current rewards rules.',
      },
      {
        title: 'Annual cleaning plans',
        text: 'An annual plan contains four quarterly cleaning visits at one address. Prices depend on the property type and AC count. Each visit needs confirmation, and later dates that fall on a weekend move to Monday. The annual amount is divided across the visits. Renewal is optional and requires a new price review; there is no automatic renewal or online charge. The account shows the renewal window and any early-renewal points offer, including the completion requirement before bonus points are awarded.',
      },
      {
        title: 'Changes, cancellations and service records',
        text: 'Request a change or cancellation at least 72 hours before the original appointment. A replacement date must also be at least 72 hours ahead and satisfy availability and booking rules. Annual visits must remain within their quarterly window. If work or parts usage has already started, contact the service team. Submitted requests can expire if they are not confirmed by the deadline shown in the booking; later reserved annual visits do not automatically expire. Service reports, parts usage, ratings and rewards remain linked to their relevant bookings.',
      },
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    introduction: 'This notice describes the information used by this CoolCare installation. Use fictional information for coursework evaluation and avoid submitting sensitive personal information.',
    sections: [
      {
        title: 'Information held in your account',
        text: 'The service stores account and contact details, saved addresses, property and AC information, booking requests and notes, assistant booking drafts, service reports, uploaded photos and signatures, feedback and reward activity. Passwords are stored as hashes rather than readable passwords. Administrative actions and changes to service records may also be logged.',
      },
      {
        title: 'Why the information is used',
        text: 'Account information supports sign-in, booking, scheduling, technician assignment, service documentation, customer support, reviews and rewards. Administrators use business records for operational reports and audit history. Add only information relevant to the requested service to notes, photos and reports.',
      },
      {
        title: 'Who can access service records',
        text: 'Customers can access their own account and booking records. Authorised administrators manage service operations. Technicians can access assigned work and related service information permitted by their role. Hosting and database systems process information to operate the website. Email delivery also involves the configured mail provider when external sending is enabled.',
      },
      {
        title: 'Cookies and external links',
        text: 'Session cookies are used for sign-in and account security. Signing out ends your current session. Homepage images may load from an external image provider, which receives the browser request. Support links open your own email application; CoolCare does not send a message merely because you open a support link.',
      },
      {
        title: 'Notifications and account access',
        text: 'Booking status is available inside your account. Email notifications depend on the configured sending service; this installation does not offer SMS notifications or automatic password-reset emails. Never send your password to support. Account-access requests need identity checks before account changes can be made.',
      },
      {
        title: 'Updating information and retained history',
        text: 'You can update your profile and manage saved addresses in your account. Changes to an address do not rewrite historical bookings. Service, inventory, reward and audit records are retained to preserve the history of previous operations. Contact support to request a correction or discuss removal of account information; some linked historical records may need to be retained. Do not upload another person’s personal information without permission.',
      },
    ],
  },
};

export function PolicyDocument({ kind }: { kind: PolicyKind }) {
  const policy = policyContent[kind];
  return <>
    <p className="text-sm text-ac-on-surface-variant">Updated 6 November 2026</p>
    <p className="mt-4 text-base leading-7 text-ac-on-surface-variant">{policy.introduction}</p>
    <div className="mt-8 space-y-7">
      {policy.sections.map((section, index) => <section key={section.title}>
        <h2 className="text-lg font-semibold text-ac-on-background">{index + 1}. {section.title}</h2>
        <p className="mt-2 text-sm leading-7 text-ac-on-surface-variant">{section.text}</p>
      </section>)}
      <section className="rounded-xl border border-ac-outline-variant bg-ac-surface-container-low p-5">
        <h2 className="font-semibold text-ac-on-background">Questions or account help</h2>
        <p className="mt-2 text-sm leading-6 text-ac-on-surface-variant">Contact the CoolCare project team. Include your account email or booking reference where relevant, but never your password.</p>
        <a className="mt-3 inline-flex min-h-11 items-center break-all font-semibold text-ac-primary underline underline-offset-4" href={'mailto:' + customerSupportEmail + '?subject=' + encodeURIComponent('CoolCare ' + policy.title + ' enquiry')}>{customerSupportEmail}</a>
      </section>
    </div>
  </>;
}

export function PolicyPage({ kind, onNavigate }: { kind: PolicyKind; onNavigate: (page: PageRoute) => void }) {
  return <main className="w-full flex-grow bg-ac-surface-container-low px-4 py-8 sm:px-6 sm:py-12">
    <div className="mx-auto max-w-3xl">
      <Button variant="ghost" onClick={() => onNavigate('home')} className="mb-5 gap-2 px-0 text-ac-primary"><SiteIcon>arrow_back</SiteIcon>Back to Home</Button>
      <article className="rounded-2xl border border-ac-outline-variant/40 bg-ac-surface p-6 shadow-sm sm:p-10">
        <h1 className="mb-3 text-3xl font-bold text-ac-on-background">{policyContent[kind].title}</h1>
        <PolicyDocument kind={kind} />
      </article>
    </div>
  </main>;
}
