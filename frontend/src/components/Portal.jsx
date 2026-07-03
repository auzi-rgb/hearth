import { createPortal } from 'react-dom'

// Renders children directly under document.body, outside the page's DOM subtree.
//
// Why this exists: every page is wrapped in `.page-enter`, which runs a CSS animation
// that ends with `transform: translateY(0)` and stays applied (animation-fill-mode:
// forwards). A `transform` on ANY ancestor — even a no-op one like translateY(0) —
// makes `position: fixed` descendants position relative to that ancestor instead of
// the actual browser viewport. Every anchored popover (Add Loan, Add Credit Card, Add
// Account, Edit Categories, Budget) was silently mispositioned because of this. A
// portal sidesteps the problem entirely: these elements are no longer descendants of
// `.page-enter` in the DOM, so `position: fixed` means the real viewport again.
export default function Portal({ children }) {
  return createPortal(children, document.body)
}
