import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TasksTable from '~/components/statistics/TasksTable.vue'
import type { TaskCompletionRecord } from '~/store/taskStatistics'

const rows = (n: number): TaskCompletionRecord[] => Array.from({ length: n }, (_, i) => ({
  taskId: `t${i}`, title: `Task ${i}`, completedAt: new Date(2026, 10, 4, 10, 0), timeBoxSeconds: 1800, actualTimeSpentSeconds: 1800,
  estimationAccuracy: 100, topic: null, topicColorCode: null, activity: null, isUnplanned: false,
}))

describe('TasksTable pager (#604)', () => {
  it('goes back to the first page when the list changes', async () => {
    const wrapper = mount(TasksTable, { props: { tasks: rows(60) } })
    await wrapper.find('[data-testid="stats-table-more"]').trigger('click')
    expect(wrapper.find('[data-testid="stats-table-shown"]').text()).toContain('50')
    await wrapper.setProps({ tasks: rows(60) })
    expect(wrapper.find('[data-testid="stats-table-shown"]').text()).toContain('25')
  })
})
