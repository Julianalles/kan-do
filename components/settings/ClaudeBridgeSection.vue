<!--
@component ClaudeBridgeSection
@kind component
@category input
@description The Claude connection on /settings/claude (ADR 023): purpose, then either the address and token form or, once connected, the host, the on/off switch, the status line and "Trennen". One flat sheet, no card.
@usage <ClaudeBridgeSection /> (desktop only: the page redirects on web)
@avoid Only the MCP bridge settings; the GitHub token rows are GithubTokenRow and the Notion token is TokenStep. Never shows or keeps the token after saving.
@responsibility
- Load the saved host and token presence when it opens (`useRemoteBridge().refresh`)
- Connect (address checked by Rust, token written to the Keychain, field emptied at once), switch on and off, disconnect
- Every failure is a fixed sentence from i18n, never a raw error; offline and a blocked data file read as calm lines
-->
<template>
  <PageSheet tag="section" aria-labelledby="claude-bridge-heading" class="space-y-3" data-testid="claude-bridge">
    <div class="space-y-1">
      <SectionHeader id="claude-bridge-heading" tag="h2">{{ t('settings.claude.title') }}</SectionHeader>
      <p class="text-body text-muted">{{ t('settings.claude.purpose') }}</p>
      <p class="text-body text-muted">{{ t('settings.claude.whileOpen') }}</p>
    </div>

    <!-- Connected -->
    <div v-if="connected" class="space-y-3" data-testid="claude-bridge-connected">
      <p class="text-body">
        <span class="text-muted">{{ t('settings.claude.hostLabel') }}</span>
        <span class="ml-2 font-mono" data-selectable>{{ bridge.state.host }}</span>
      </p>
      <USwitch
        :model-value="bridge.enabled.value"
        :label="t('settings.claude.switchLabel')"
        :description="t('settings.claude.switchHelp')"
        data-testid="claude-bridge-switch"
        @update:model-value="bridge.setEnabled($event)"
      />
      <p v-if="statusText" class="text-body text-muted" role="status" data-testid="claude-bridge-status">{{ statusText }}</p>
      <UAlert
        v-if="problemText"
        :color="problemIsCalm ? 'neutral' : 'error'"
        variant="subtle"
        :icon="problemIsCalm ? 'i-ph-info' : 'i-ph-warning-circle'"
        role="status"
        :description="problemText"
        data-testid="claude-bridge-problem"
      />
      <UButton variant="soft" color="error" :icon="ICONS.delete" :loading="busy" @click="onDisconnect">
        {{ t('settings.claude.disconnect') }}
      </UButton>
    </div>

    <!-- Not connected -->
    <form v-else class="space-y-3" data-testid="claude-bridge-empty" @submit.prevent="onConnect">
      <UFormField :label="t('settings.claude.urlLabel')" :error="urlError ?? false" :help="t('settings.claude.urlHelp')">
        <UInput v-model="url" type="url" :placeholder="t('settings.claude.urlPlaceholder')" class="w-full" autocomplete="off" data-private />
      </UFormField>
      <UFormField :label="t('settings.claude.tokenLabel')" :error="tokenError ?? false" :help="t('settings.claude.tokenHelp')">
        <UInput
          v-model="token"
          type="password"
          :placeholder="t('settings.claude.tokenPlaceholder')"
          class="w-full"
          autocomplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
        />
      </UFormField>
      <UAlert v-if="failureText" color="error" variant="subtle" icon="i-ph-warning-circle" role="alert" :description="failureText" />
      <UButton type="submit" variant="soft" color="neutral" :loading="busy" :disabled="!url.trim() || !token.trim() || busy">
        {{ busy ? t('settings.claude.connecting') : t('settings.claude.connect') }}
      </UButton>
    </form>
  </PageSheet>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import PageSheet from '~/components/ui/PageSheet.vue';
import SectionHeader from '~/components/ui/SectionHeader.vue';
import { useRemoteBridge } from '~/composables/useRemoteBridge';
import { toSecretError } from '~/composables/useSecrets';
import { ICONS } from '~/lib/icons';

defineOptions({ name: 'ClaudeBridgeSection' });

const { t } = useI18n();
const bridge = useRemoteBridge();

const url = ref('');
const token = ref('');
const busy = ref(false);
const urlError = ref<string | null>(null);
const tokenError = ref<string | null>(null);
const failureText = ref<string | null>(null);

const connected = computed(() => bridge.state.host !== null && bridge.state.tokenPresent);

onMounted(() => { void bridge.refresh(); });

async function onConnect() {
  urlError.value = tokenError.value = failureText.value = null;
  busy.value = true;
  try {
    await bridge.connect(url.value, token.value.trim());
    // The token is not kept: the field is emptied the moment Rust has it.
    token.value = '';
    url.value = '';
  } catch (error) {
    const kind = toSecretError(error).kind;
    if (kind === 'invalid_request') urlError.value = t('settings.claude.problem.invalidUrl');
    else if (kind === 'keychain' || kind === 'unsupported') failureText.value = t('settings.claude.problem.keychain');
    else failureText.value = t('settings.claude.problem.generic');
  } finally {
    busy.value = false;
  }
}

async function onDisconnect() {
  busy.value = true;
  try {
    await bridge.disconnect();
  } catch {
    failureText.value = t('settings.claude.problem.generic');
  } finally {
    busy.value = false;
  }
}

const statusText = computed(() => {
  if (!bridge.enabled.value) return t('settings.claude.statusOff');
  if (bridge.state.lastSyncAt !== null && bridge.state.problem === null) return t('settings.claude.statusSynced');
  return null;
});

const problemText = computed(() => {
  const problem = bridge.state.problem;
  return problem ? t(`settings.claude.problem.${problem}`) : null;
});
// Offline and a blocked data file are not the user's mistake: a calm line, not an error.
const problemIsCalm = computed(() => ['network', 'timeout', 'blocked'].includes(bridge.state.problem ?? ''));
</script>
