import type { AgentSideConnection, PermissionOption, RequestPermissionResponse } from "@agentclientprotocol/sdk"
import type { Event, OpencodeClient } from "@opencode-ai/sdk/v2"
import { Effect } from "effect"
import type { ACPSession } from "./session"

type QuestionEvent = Extract<Event, { type: "question.asked" }>
type Connection = Partial<Pick<AgentSideConnection, "requestPermission">>

/** plan_enter / plan_exit 触发的确认问题映射为 ACP switch_mode 权限请求。 */
const SWITCH_MODE_TOOLS = new Set(["plan_enter", "plan_exit"])

const fallbackOptions: PermissionOption[] = [
  { optionId: "0", kind: "allow_once", name: "OK" },
  { optionId: "1", kind: "reject_once", name: "Cancel" },
]

/**
 * Bridge opencode `question.asked` events (e.g. the plan_exit tool's
 * "switch to build agent?" confirmation) to ACP `session/request_permission`.
 *
 * Without this bridge nobody answers Question.ask over ACP — the tool's
 * Effect never resolves and the turn hangs. When the client has no
 * requestPermission channel the question is rejected immediately instead of
 * parking forever.
 */
export class Handler {
  private readonly queues = new Map<string, Promise<void>>()

  constructor(
    private readonly input: {
      sdk: OpencodeClient
      connection: Connection
      session: ACPSession.Interface
      /** callID → 工具名（Subscription 的 tool 事件维护），用于 switch_mode 映射。 */
      toolNameFor?: (callID: string) => string | undefined
    },
  ) {}

  handle(event: QuestionEvent) {
    const question = event.properties
    const previous = this.queues.get(question.sessionID) ?? Promise.resolve()
    const next = previous
      .then(() => this.process(event))
      .catch(() => {})
      .finally(() => {
        if (this.queues.get(question.sessionID) === next) {
          this.queues.delete(question.sessionID)
        }
      })
    this.queues.set(question.sessionID, next)
  }

  private async process(event: QuestionEvent) {
    const question = event.properties
    const session = await Effect.runPromise(this.input.session.tryGet(question.sessionID))
    if (!session) return

    if (!this.input.connection.requestPermission) {
      await this.reject(question.id, session.cwd)
      return
    }

    const first = question.questions[0]
    if (!first) {
      await this.reject(question.id, session.cwd)
      return
    }

    const toolCallId = question.tool?.callID ?? question.id
    const toolName = question.tool
      ? this.input.toolNameFor?.(question.tool.callID)
      : undefined

    // 首个选项是肯定项（plan_exit 的 Yes / plan_enter 的确认）；
    // 其余按拒绝项处理——2 选项确认场景的标准形态。
    const options: PermissionOption[] = first.options.length
      ? first.options.map((option, index) => ({
          optionId: String(index),
          kind: index === 0 ? ("allow_once" as const) : ("reject_once" as const),
          name: option.label,
        }))
      : fallbackOptions

    const result = await this.input.connection
      .requestPermission({
        sessionId: question.sessionID,
        toolCall: {
          toolCallId,
          status: "pending",
          title: first.header,
          rawInput: {
            question: first.question,
            header: first.header,
            options: first.options,
          },
          ...(toolName && SWITCH_MODE_TOOLS.has(toolName) ? { kind: "switch_mode" } : {}),
        },
        options,
      })
      .catch(async () => {
        await this.reject(question.id, session.cwd)
        return undefined
      })

    if (!result) return

    // 客户端"选中"了 reject_once 选项（outcome 仍是 selected）语义上是否定，
    // 映射为 question.reject 而非把否定标签当答案回填。
    const selected = selectedOption(result, options)
    if (!selected || selected.kind !== "allow_once") {
      await this.reject(question.id, session.cwd)
      return
    }

    const label = first.options[Number(selected.optionId)]?.label
    if (!label) {
      await this.reject(question.id, session.cwd)
      return
    }

    await this.input.sdk.question
      .reply({
        requestID: question.id,
        directory: session.cwd,
        answers: [[label]],
      })
      .catch(() => {})
  }

  private async reject(requestID: string, directory: string) {
    await this.input.sdk.question
      .reject({ requestID, directory })
      .catch(() => {})
  }
}

function selectedOption(
  result: RequestPermissionResponse,
  options: PermissionOption[],
): PermissionOption | undefined {
  const outcome = result.outcome
  if (outcome.outcome !== "selected") return undefined
  return options.find((option) => option.optionId === outcome.optionId)
}

export * as ACPQuestion from "./question"
