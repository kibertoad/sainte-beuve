<script setup lang="ts">
import type { MergeComment } from '@sainte-beuve/contracts'
import { MAX_MERGE_COMMENTS } from '@sainte-beuve/contracts'

// The merge comments one level configures: a label for the button on My PRs and
// the body posted verbatim for a merge bot. A team or a project may instead
// inherit the level above, which is `null` on the wire.
const props = defineProps<{
  /** What "inherit" means here, e.g. "the organization's". Absent means the level cannot inherit. */
  inheritFrom?: string
  disabled?: boolean
}>()

const comments = defineModel<MergeComment[] | null>({ required: true })

const inherits = computed({
  get: () => comments.value === null,
  set: (inherit: boolean) => {
    comments.value = inherit ? null : []
  },
})

function update(index: number, field: keyof MergeComment, value: string) {
  comments.value = (comments.value ?? []).map((comment, at) =>
    at === index ? { ...comment, [field]: value } : comment,
  )
}

function add() {
  comments.value = [...(comments.value ?? []), { label: '', body: '' }]
}

function remove(index: number) {
  comments.value = (comments.value ?? []).filter((_, at) => at !== index)
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <UCheckbox
      v-if="props.inheritFrom"
      v-model="inherits"
      :label="`Use ${props.inheritFrom} merge comments`"
      :disabled="disabled"
    />
    <template v-if="comments !== null">
      <p v-if="comments.length === 0" class="text-sm text-muted">
        No merge comments{{ props.inheritFrom ? ', even if the level above has some' : '' }}.
      </p>
      <div
        v-for="(comment, index) in comments"
        :key="index"
        class="grid grid-cols-1 gap-2 sm:grid-cols-[12rem_1fr_auto] sm:items-end"
      >
        <UFormField label="Button label">
          <UInput
            :model-value="comment.label"
            class="w-full"
            placeholder="Add to merge queue"
            :disabled="disabled"
            @update:model-value="update(index, 'label', String($event))"
          />
        </UFormField>
        <UFormField label="Comment posted">
          <UInput
            :model-value="comment.body"
            class="w-full font-mono"
            placeholder="/merge"
            :disabled="disabled"
            @update:model-value="update(index, 'body', String($event))"
          />
        </UFormField>
        <UButton
          v-if="!disabled"
          icon="i-lucide-trash-2"
          variant="ghost"
          color="error"
          class="justify-self-end"
          :aria-label="`Remove ${comment.label || 'this merge comment'}`"
          @click="remove(index)"
        />
      </div>
      <div v-if="!disabled && comments.length < MAX_MERGE_COMMENTS">
        <UButton icon="i-lucide-plus" variant="soft" size="sm" @click="add()">
          Add a merge comment
        </UButton>
      </div>
    </template>
  </div>
</template>
