export interface ActionItem {
  id: string
  text: string
  assignee: string | null
  completed: boolean
}

export interface Summary {
  id: string
  meetingId: string
  content: string
  actionItems: ActionItem[]
  keyTopics: string[]
  decisions: string[]
}

export interface SummarizeOptions {
  language?: string
  includeActionItems?: boolean
  includeKeyTopics?: boolean
  includeDecisions?: boolean
  customPrompt?: string
}
