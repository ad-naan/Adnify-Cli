import type {
  UserChoiceAnswer,
  UserChoiceRequest,
  UserChoiceSnapshot,
  UserInteractionController,
  UserInteractionPort,
} from '../../application/ports/UserInteractionPort'

interface PendingInteraction {
  request: UserChoiceRequest
  questionIndex: number
  answers: UserChoiceAnswer[]
  settle: (answers: UserChoiceAnswer[] | null) => void
  abortSignal?: AbortSignal
  abortListener?: () => void
}

export class PendingUserInteractionAdapter implements UserInteractionPort, UserInteractionController {
  private pending: PendingInteraction | null = null
  private observer: ((snapshot: UserChoiceSnapshot | null) => void) | null = null

  requestChoices(request: UserChoiceRequest, abortSignal?: AbortSignal): Promise<UserChoiceAnswer[] | null> {
    if (this.pending) return Promise.resolve(null)
    if (abortSignal?.aborted) return Promise.resolve(null)

    return new Promise((resolve) => {
      const entry: PendingInteraction = {
        request,
        questionIndex: 0,
        answers: [],
        settle: resolve,
        abortSignal,
      }
      if (abortSignal) {
        entry.abortListener = () => this.cancelPending()
        abortSignal.addEventListener('abort', entry.abortListener, { once: true })
      }
      this.pending = entry
      this.notify()
    })
  }

  setObserver(observer: ((snapshot: UserChoiceSnapshot | null) => void) | null): void {
    this.observer = observer
    this.notify()
  }

  getPending(): UserChoiceSnapshot | null {
    const entry = this.pending
    const question = entry?.request.questions[entry.questionIndex]
    return entry && question
      ? { question, questionIndex: entry.questionIndex, questionCount: entry.request.questions.length }
      : null
  }

  selectOption(index: number): boolean {
    const entry = this.pending
    const question = entry?.request.questions[entry.questionIndex]
    const option = question?.options[index]
    if (!entry || !question || !option) return false

    entry.answers.push({ questionId: question.id, selectedIndex: index, label: option.label })
    entry.questionIndex += 1
    if (entry.questionIndex < entry.request.questions.length) {
      this.notify()
      return true
    }

    this.finish(entry.answers)
    return true
  }

  cancelPending(): void {
    if (!this.pending) return
    this.finish(null)
  }

  private finish(answers: UserChoiceAnswer[] | null): void {
    const entry = this.pending
    if (!entry) return
    if (entry.abortSignal && entry.abortListener) {
      entry.abortSignal.removeEventListener('abort', entry.abortListener)
    }
    this.pending = null
    entry.settle(answers)
    this.notify()
  }

  private notify(): void {
    this.observer?.(this.getPending())
  }
}
