// Shared EUC metadata label helpers, used by both the detail-page header and
// the Summary tab so the two never drift.

// Backend ProjectKeyUse enum -> human label (primary usage / key use).
export const KEY_USE_LABELS = {
  regulatory_reporting: 'Regulatory Reporting',
  board_reporting: 'Board Reporting',
  financial_reporting: 'Financial Reporting',
  client_services: 'Client Services',
  client_billing: 'Client Billing',
  risk_management: 'Risk Management',
  compliance: 'Compliance',
  restricted_info: 'Restricted Information',
  transaction_processing: 'Transaction Processing',
  key_controls: 'Key Controls',
  other: 'Other',
};

export const KEY_USE_OPTIONS = Object.entries(KEY_USE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

// Free-text "Primary Usage" options shown at creation and when editing - kept
// in one place so the create modal and the Summary editor never drift.
export const PRIMARY_USAGES = [
  'Financial Reporting',
  'Risk Management',
  'Regulatory Compliance',
  'Management Information',
  'Operational Control',
  'Data Reconciliation',
  'Other',
];

// Mellow, theme-aware chip tints. We avoid the bright `-50/-100` shades (which
// glare on dark backgrounds and overshadow the primary actions) in favour of a
// soft 10% wash + a readable, lightness-adjusted text colour per theme.
export const SOFT_CHIP = {
  blue: 'bg-blue-500/10 text-blue-600 ring-blue-500/20 dark:text-blue-300',
  amber: 'bg-amber-500/10 text-amber-600 ring-amber-500/20 dark:text-amber-300',
  emerald: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/20 dark:text-emerald-300',
  violet: 'bg-violet-500/10 text-violet-600 ring-violet-500/20 dark:text-violet-300',
  sky: 'bg-sky-500/10 text-sky-600 ring-sky-500/20 dark:text-sky-300',
  rose: 'bg-rose-500/10 text-rose-600 ring-rose-500/20 dark:text-rose-300',
  muted: 'bg-secondary text-muted-foreground ring-border',
};

/** The display label for a project's primary usage (free-text purpose wins). */
export function usageLabelFor(project) {
  return project?.primaryUsage || KEY_USE_LABELS[project?.primaryKeyUse] || '';
}