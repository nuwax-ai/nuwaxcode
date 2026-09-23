import { describe, expect, it } from "bun:test"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import type { Event, OpencodeClient } from "@opencode-ai/sdk/v2"
import { Effect } from "effect"
import { ACPQuestion } from "@/acp/question"
import type { ACPSession } from "@/acp/session"

type RequestPermissionParams = Parameters<AgentSideConnection["requestPermission"]>[0]

function questionAsked(overrides?: Partial<Extract<Event, { type: "question.asked" }>["properties"]>): Event {
  return {
    id: "evt_q1",
    type: "question.asked",
    properties: {
      id: "q1",
      sessionID: "ses_1",
      questions: [
        {
          question: "Plan at .opencode/plans/x.md is complete. Switch to build agent?",
          header: "Build Agent",
          options: [
            { label: "Yes", description: "Switch to build agent" },
            { label: "No", description: "Keep planning" },
          ],
        },
      ],
      ...overrides,
    },
  } as Event
}

function createHarness(clientChoice: { optionId: string } | "cancel" | "no-channel") {
  const permissions: RequestPermissionParams[] = []
  const replies: Array<{ requestID: string; answers: string[][] }> = []
  const rejects: string[] = []

  const sdk = {
    question: {
      reply: (input: { requestID: string; answers?: string[][] }) => {
        replies.push({ requestID: input.requestID, answers: input.answers ?? [] })
        return Promise.resolve({ data: {} })
      },
      reject: (input: { requestID: string }) => {
        rejects.push(input.requestID)
        return Promise.resolve({ data: {} })
      },
    },
  } as unknown as OpencodeClient

  const connection =
    clientChoice === "no-channel"
      ? {}
      : {
          requestPermission: (_params: RequestPermissionParams) => {
            permissions.push(_params)
            if (clientChoice === "cancel") {
              return Promise.resolve({ outcome: { outcome: "cancelled" } })
            }
            return Promise.resolve({
              outcome: { outcome: "selected", optionId: clientChoice.optionId },
            })
          },
        }

  const session = {
    tryGet: () =>
      Effect.succeed({
        id: "ses_1",
        acpSessionId: "ses_1",
        cwd: "/workspace/project",
        createdAt: new Date(),
        status: "idle",
      }),
  } as unknown as ACPSession.Interface

  const handler = new ACPQuestion.Handler({
    sdk,
    connection,
    session,
    toolNameFor: (callID) => (callID === "call_plan_exit" ? "plan_exit" : undefined),
  })

  return { handler, permissions, replies, rejects }
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 10))
}

describe("acp/question bridge", () => {
  it("bridges question.asked to request_permission and replies with the selected label", async () => {
    const h = createHarness({ optionId: "0" })
    h.handler.handle(questionAsked({ tool: { messageID: "msg_1", callID: "call_plan_exit" } }) as Extract<Event, { type: "question.asked" }>)
    await flush()

    expect(h.permissions).toHaveLength(1)
    expect(h.permissions[0].sessionId).toBe("ses_1")
    expect(h.permissions[0].toolCall.toolCallId).toBe("call_plan_exit")
    expect(h.permissions[0].toolCall.kind).toBe("switch_mode")
    expect(h.permissions[0].toolCall.title).toBe("Build Agent")
    expect(h.permissions[0].options.map((o) => o.kind)).toEqual(["allow_once", "reject_once"])

    expect(h.replies).toEqual([
      { requestID: "q1", answers: [["Yes"]] },
    ])
    expect(h.rejects).toEqual([])
  })

  it("maps a rejection choice to question.reject instead of hanging", async () => {
    const h = createHarness({ optionId: "1" })
    h.handler.handle(questionAsked() as Extract<Event, { type: "question.asked" }>)
    await flush()

    expect(h.replies).toEqual([])
    expect(h.rejects).toEqual(["q1"])
  })

  it("rejects the question when the client cancels the permission dialog", async () => {
    const h = createHarness("cancel")
    h.handler.handle(questionAsked() as Extract<Event, { type: "question.asked" }>)
    await flush()

    expect(h.rejects).toEqual(["q1"])
  })

  it("rejects immediately when the client has no requestPermission channel (previously hung forever)", async () => {
    const h = createHarness("no-channel")
    h.handler.handle(questionAsked() as Extract<Event, { type: "question.asked" }>)
    await flush()

    expect(h.permissions).toHaveLength(0)
    expect(h.rejects).toEqual(["q1"])
  })

  it("uses plain kind for questions unrelated to plan tools", async () => {
    const h = createHarness({ optionId: "0" })
    h.handler.handle(questionAsked() as Extract<Event, { type: "question.asked" }>)
    await flush()

    expect(h.permissions[0].toolCall.kind).toBeUndefined()
  })
})
