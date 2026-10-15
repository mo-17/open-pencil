import { render } from '@vue-email/render'
import { h, type FunctionalComponent } from 'vue'

import { emailLayout } from './layout'

type ConfirmationEmailLinks = {
  confirmURL: string
  leaveURL: string
}

const ConfirmationEmail: FunctionalComponent<ConfirmationEmailLinks> = (props) =>
  emailLayout({
    preview: 'One click to join the OpenPencil Cloud waitlist.',
    heading: 'Confirm your email',
    message:
      'Thanks for your interest in OpenPencil Cloud. Confirm this address to join the waitlist, and we will write once, when Cloud is ready for you.',
    actionLabel: 'Join the waitlist',
    actionURL: props.confirmURL,
    note: {
      text: 'Did not sign up? Ignore this email and the address is deleted in seven days, or',
      linkLabel: 'remove it now',
      linkURL: props.leaveURL
    }
  })

ConfirmationEmail.props = {
  confirmURL: { type: String, required: true },
  leaveURL: { type: String, required: true }
}

/** The confirmation email for a waitlist sign-up; its links carry the sign-up's token only. */
export async function confirmationEmail(links: ConfirmationEmailLinks) {
  // The renderer infers props only from constructors; h checks this functional component's props.
  const email = () => h(ConfirmationEmail, links)
  const [html, text] = await Promise.all([
    render(email),
    render(email, undefined, { plainText: true })
  ])
  return { subject: 'Confirm your place on the OpenPencil Cloud waitlist', html, text }
}
