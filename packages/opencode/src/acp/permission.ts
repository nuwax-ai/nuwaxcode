import type { AgentSideConnection, PermissionOption, RequestPermissionResponse } from "@agentclientprotocol/sdk"
import type { Event, OpencodeClient } from "@opencode-ai/sdk/v2"
import { applyPatch } from "diff"
import { exists, readText } from "@/util/filesystem"
import type { ACPSession } from "./session"
import { toLocations, toToolKind, type ToolInput } from "./tool"
import { Effect } from "effect"

type PermissionEvent = Extract<Event, { type: "permission.asked" }>
type Reply = "once" | "always" | "reject"
type Connection = Partial<Pick<AgentSideConnection, "requestPermission" | "writeTextFile">>

const permissionOptions: PermissionOption[] = [
  { optionId: "once", kind: "allow_once", name: "Allow once" },
  { optionId: "always", kind: "allow_always", name: "Always allow" },
  { optionId: "reject", kind: "reject_once", name: "Reject" },
]

// Task subagents create server-side child sessions that never enter the ACP
// session registry, so resolving them to a registered ancestor must walk the
// parentID chain. The cap guards against corrupt cycles in stored parent links.
const MAX_SESSION_DEPTH = 10

export class Handler {
  private readonly queues = new Map<string, Promise<void>>()

  constructor(
    private readonly input: {
      sdk: OpencodeClient
      connection: Connection
      session: ACPSession.Interface
    },
  ) {}

  handle(event: PermissionEvent) {
    const permission = event.properties
    const previous = this.queues.get(permission.sessionID) ?? Promise.resolve()
    const next = previous
      .then(() => this.process(event))
      .catch(() => {})
      .finally(() => {
        if (this.queues.get(permission.sessionID) === next) {
          this.queues.delete(permission.sessionID)
        }
      })
    this.queues.set(permission.sessionID, next)
  }

  private async process(event: PermissionEvent) {
    const permission = event.properties
    const session = await this.resolveSession(permission.sessionID)
    if (!session) {
      // No registered session and no registered ancestor: nothing can answer
      // this ask. Rejecting fails fast instead of leaving the asking session
      // blocked on a Deferred that will never complete.
      await Effect.runPromise(
        Effect.logWarning("permission ask from unresolvable session, rejecting", {
          sessionID: permission.sessionID,
          permission: permission.permission,
        }),
      )
      await this.reply(permission.id, "reject")
      return
    }

    if (!this.input.connection.requestPermission) {
      await this.reply(permission.id, "reject", session.cwd)
      return
    }

    const result = await this.input.connection
      .requestPermission({
        sessionId: session.id,
        toolCall: {
          toolCallId: permission.tool?.callID ?? permission.id,
          status: "pending",
          title: permission.permission,
          rawInput: permission.metadata,
          kind: toToolKind(permission.permission),
          locations: toLocations(permission.permission, permission.metadata),
        },
        options: permissionOptions,
      })
      .catch(async () => {
        await this.reply(permission.id, "reject", session.cwd)
        return undefined
      })

    if (!result) return

    const reply = selectedReply(result)
    if (reply !== "once" && reply !== "always") {
      await this.reply(permission.id, "reject", session.cwd)
      return
    }

    if (permission.permission === "edit") {
      await this.writeProposedEdit(session.id, permission.metadata).catch(() => {})
    }

    await this.reply(permission.id, reply, session.cwd)
  }

  private async resolveSession(sessionID: string): Promise<ACPSession.Info | undefined> {
    const direct = await Effect.runPromise(this.input.session.tryGet(sessionID))
    if (direct) return direct

    let current = sessionID
    for (let depth = 0; depth < MAX_SESSION_DEPTH; depth++) {
      const info = await this.input.sdk.session
        .get({ sessionID: current })
        .then((result) => result.data)
        .catch(() => undefined)
      const parentID = info?.parentID
      if (!parentID) return undefined

      const parent = await Effect.runPromise(this.input.session.tryGet(parentID))
      if (parent) {
        await Effect.runPromise(
          Effect.logInfo("permission ask from descendant session, forwarding via registered ancestor", {
            sessionID,
            ancestorID: parent.id,
          }),
        )
        return parent
      }
      current = parentID
    }
    return undefined
  }

  private async reply(requestID: string, reply: Reply, directory?: string) {
    await this.input.sdk.permission.reply({
      requestID,
      reply,
      ...(directory ? { directory } : {}),
    })
  }

  private async writeProposedEdit(sessionId: string, metadata: ToolInput) {
    const filepath = stringValue(metadata.filepath)
    const diff = stringValue(metadata.diff)
    if (!filepath || !diff || !this.input.connection.writeTextFile) return

    const content = (await exists(filepath)) ? await readText(filepath) : ""
    const next = applyPatch(content, diff)
    if (next === false) {
      return
    }

    void this.input.connection.writeTextFile({
      sessionId,
      path: filepath,
      content: next,
    })
  }
}

function selectedReply(result: RequestPermissionResponse): Reply {
  if (result.outcome.outcome !== "selected") return "reject"
  if (result.outcome.optionId === "once" || result.outcome.optionId === "always") return result.outcome.optionId
  return "reject"
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}

export * as ACPPermission from "./permission"
