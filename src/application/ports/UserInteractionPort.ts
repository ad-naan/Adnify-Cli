export interface UserChoiceOption {
  label: string
  description: string
}

export interface UserChoiceQuestion {
  id: string
  header: string
  question: string
  options: UserChoiceOption[]
}

export interface UserChoiceRequest {
  questions: UserChoiceQuestion[]
}

export interface UserChoiceAnswer {
  questionId: string
  selectedIndex: number
  label: string
}

export interface UserChoiceSnapshot {
  question: UserChoiceQuestion
  questionIndex: number
  questionCount: number
}

export interface UserInteractionPort {
  requestChoices(request: UserChoiceRequest, abortSignal?: AbortSignal): Promise<UserChoiceAnswer[] | null>
}

export interface UserInteractionController {
  setObserver(observer: (snapshot: UserChoiceSnapshot | null) => void): void
  getPending(): UserChoiceSnapshot | null
  selectOption(index: number): boolean
  cancelPending(): void
}
