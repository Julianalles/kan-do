/**
 * Which setup stage the Notion settings page opens with (#652). Pure, so the rules are testable.
 * The board decides connect versus repair, never the stored config: a connected source whose
 * config is incomplete (after an import or a Keychain miss) still repairs at the token step.
 */
export type NotionSetupStage = { purpose: 'connect' | 'repair'; mode: 'setup' | 'settings'; intro: boolean };

export function notionStageOnArrival(asked: string | null | undefined, connected: boolean): NotionSetupStage | null {
  if (!connected || asked === 'connect') return { purpose: 'connect', mode: 'setup', intro: true };
  if (asked === 'repair') return { purpose: 'repair', mode: 'setup', intro: false };
  if (asked === 'settings') return { purpose: 'repair', mode: 'settings', intro: false };
  return null;
}
