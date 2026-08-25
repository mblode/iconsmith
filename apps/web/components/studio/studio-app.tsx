"use client";

import Paperclip from "blode-icons-react/icons/paperclip-1";
import X from "blode-icons-react/icons/x";
import type { ClientSessionState, MessageStreamEvent } from "eve/client";
import type { EveMessageInputRequest } from "eve/react";
import { useEveAgent } from "eve/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AgentActivityCard } from "@/components/studio/agent-activity-card";
import { AnnotationPanel } from "@/components/studio/annotation-panel";
import { ExplorationBoard } from "@/components/studio/exploration-board";
import { IconStage } from "@/components/studio/icon-stage";
import { LibraryBrowser } from "@/components/studio/library-browser";
import { CampaignPanel } from "@/components/studio/campaign-panel";
import { ChatSwitcher } from "@/components/studio/chat-switcher";
import { OverviewTable } from "@/components/studio/overview-table";
import { ThinkingCard } from "@/components/studio/thinking-card";
import { StudioWorkspace } from "@/components/studio/studio-workspace";
import { studioOwnerHeaders } from "@iconsmith/contract/session-owner";
import { VersionRail } from "@/components/studio/version-rail";
import {
  Attachment,
  AttachmentContent,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { ThinkingIndicator } from "@/components/ui/thinking-indicator";
import { Message, MessageContent, MessageHeader } from "@/components/ui/message";
import { MessageScroller, MessageScrollerContent } from "@/components/ui/message-scroller";
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireFreeform,
  QuestionnaireProgress,
  QuestionnaireTitle,
} from "@/components/ui/questionnaire";
import { InputMessage } from "@/components/ui/input-message";
import { Textarea } from "@/components/ui/textarea";
import { BASE_PATH } from "@/lib/site-url";
import { studioFaultFromUnknown } from "@/lib/studio/fault";
import type { CampaignItem } from "@/lib/studio/campaign";
import type { OverviewSpec } from "@/lib/studio/overview";
import { recordThread } from "@/lib/studio/threads";
import type { StudioThread } from "@/lib/studio/threads";
import { buildOverview, overviewSubjects } from "@/lib/studio/overview";
import { hasDrawnWork, useCampaign } from "@/lib/use-campaign";
import {
  readStudioAnnotations,
  readStudioSession,
  writeStudioAnnotations,
  writeStudioSession,
} from "@/lib/studio/store";
import type {
  StudioActivity,
  StudioAnnotation,
  StudioAttachment,
  StudioFinish,
  StudioQuestion,
  StudioRequest,
  StudioTournament,
  StudioVersion,
} from "@iconsmith/contract/types";
import { diagnoseStudioFinish } from "@/lib/studio/finish";
import { studioProgressSchema, studioResponseSchema } from "@iconsmith/contract/types";

type Turn =
  | {
      attachments: readonly StudioAttachment[];
      id: string;
      role: "user";
      text: string;
    }
  | {
      activities?: readonly StudioActivity[];
      id: string;
      questions?: readonly StudioQuestion[];
      role: "assistant";
      text: string;
      tournament?: StudioTournament;
      versions?: readonly StudioVersion[];
    };

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

/** Matches the server's per-attachment cap in `studioAttachmentSchema`. */
const MAX_ATTACHMENT_BYTES = 1_500_000;

const kindOf = (file: File): StudioAttachment["kind"] => {
  if (file.type === "image/svg+xml" || file.name.endsWith(".svg")) {
    return "svg";
  }
  if (file.type.startsWith("image/")) {
    return "image";
  }
  return "file";
};

const readFile = async (file: File): Promise<StudioAttachment> => {
  const kind = kindOf(file);
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`${file.name} is over 1.5MB.`);
  }
  if (kind === "file") {
    const readable =
      file.type.startsWith("text/") ||
      file.type === "application/json" ||
      /\.(?:json|md|txt)$/iu.test(file.name);
    const content = readable ? await file.text() : undefined;
    return {
      kind,
      name: file.name,
      size: file.size,
      text: content?.slice(0, 30_000),
      type: file.type || "application/octet-stream",
    };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return {
    dataUrl: `data:${file.type || "application/octet-stream"};base64,${btoa(binary)}`,
    kind,
    name: file.name,
    size: file.size,
    type: file.type,
  };
};

/**
 * Recovers what the user typed from the envelope the agent was sent.
 *
 * Every turn goes over the wire as `STUDIO_REQUEST` followed by the tool input,
 * which is right for the model and unreadable as a transcript.
 */
const studioBriefOf = (message: string): string | null => {
  const marker = "STUDIO_REQUEST";
  if (!message.startsWith(marker)) {
    return message.trim() || null;
  }
  try {
    const payload = JSON.parse(message.slice(marker.length)) as { text?: unknown };
    return typeof payload.text === "string" ? payload.text : null;
  } catch {
    return null;
  }
};

const attachmentKey = (file: StudioAttachment) => `${file.source ?? "local"}:${file.name}`;

type WorkspaceView = "focus" | "explorations" | "overviews";
type InspectorView = "versions" | "library" | "comments" | "backlog";

const SUGGESTIONS = ["wifi", "inbox", "briefcase", "umbrella", "qr-code", "home"];

const promptHint = (
  pending: "questions" | null,
  intervening: boolean,
  awaiting: boolean,
): string => {
  if (awaiting) {
    return "Answer the question above to continue";
  }
  if (pending === "questions") {
    return "Answer the questions, or type the object noun";
  }
  if (intervening) {
    return "Intervene — taller handle, filled, try inbox…";
  }
  return "wifi, a tray for mail, briefcase…";
};

/**
 * eve names the request; the Studio names what it means. The approval body is
 * the consent copy the old in-band card carried, kept because it states exactly
 * what is read and what is discarded.
 */
const requestTitle = (kind: EveMessageInputRequest["kind"]): string => {
  if (kind === "tool-approval") {
    return "Read the attachment as composition?";
  }
  if (kind === "session-limit") {
    return "This session has reached its token budget";
  }
  return "One question before I draw";
};

const requestBody = (request: EveMessageInputRequest): string =>
  request.kind === "tool-approval"
    ? "Iconsmith will reduce the image to composition words — element count, coarse region, scale band, and adjacency — then discard its geometry. It will not trace the file or imitate another library's paths."
    : request.prompt;

/**
 * A progress snapshot from the pipeline tool, if this event carries one.
 *
 * `action.partial` is how eve publishes a non-final `yield` from a tool
 * generator: `data.result.output` holds whatever the tool yielded, and its
 * docs are explicit that these are snapshots, "last-write-wins by tool call
 * id, not append-only progress", because the durable runtime can replay them.
 * So this returns the whole list and the caller replaces rather than appends.
 *
 * Everything is checked before it is trusted: the output crosses a JSON wire
 * as `JsonValue`, so a shape that does not match is ignored rather than
 * rendered as a row full of `undefined`.
 */
const progressSnapshot = (event: MessageStreamEvent): readonly StudioActivity[] | null => {
  if (event.type !== "action.partial") {
    return null;
  }
  const { result } = event.data;
  if (result.kind !== "tool-result" || result.toolName !== "generate_icon_pair") {
    return null;
  }
  const parsed = studioProgressSchema.safeParse(result.output);
  return parsed.success ? parsed.data.activities : null;
};

const agentActivity = (event: MessageStreamEvent): StudioActivity | null => {
  if (event.type === "session.started") {
    return {
      id: "eve-session",
      label: "Durable Eve session started",
      state: "complete",
    };
  }
  if (event.type === "turn.started") {
    return {
      detail: "The turn is recorded and can be streamed or resumed.",
      id: `turn:${event.data.turnId}`,
      label: "Studio request accepted",
      state: "complete",
    };
  }
  if (event.type === "reasoning.appended") {
    return {
      detail: "Private model reasoning stays private; the actionable pipeline events appear below.",
      id: `reasoning:${event.data.turnId}`,
      label: "Icon agent is planning the tool call",
      state: "active",
    };
  }
  if (event.type === "actions.requested") {
    const action = event.data.actions.find(
      (candidate) => candidate.kind === "tool-call" && candidate.toolName === "generate_icon_pair",
    );
    if (!action || action.kind !== "tool-call") {
      return null;
    }
    return {
      detail:
        "Validating the request, drawing both paints, rendering, linting, and visual reviewing.",
      id: `action:${action.callId}`,
      label: "Running the paired icon pipeline",
      state: "active",
    };
  }
  if (event.type === "action.result" && event.data.result.kind === "tool-result") {
    return {
      detail:
        event.data.status === "completed"
          ? "Exact renders and audit records returned to Studio."
          : event.data.error?.message,
      id: `action:${event.data.result.callId}`,
      label:
        event.data.status === "completed"
          ? "Paired icon pipeline completed"
          : "Paired icon pipeline failed",
      state: event.data.status === "completed" ? "complete" : "failed",
    };
  }
  if (event.type === "step.completed") {
    return {
      id: `step:${event.data.turnId}:${event.data.stepIndex}`,
      label: `Agent step ${event.data.stepIndex + 1} completed`,
      state: "complete",
    };
  }
  if (event.type === "turn.completed") {
    return {
      detail: "The session is ready for the next intervention.",
      id: `turn-complete:${event.data.turnId}`,
      label: "Eve turn committed",
      state: "complete",
    };
  }
  if (event.type === "turn.failed" || event.type === "step.failed") {
    return {
      detail: event.data.message,
      id: `failure:${event.meta.id}`,
      label: "Agent turn failed",
      state: "failed",
    };
  }
  return null;
};

// oxlint-disable-next-line eslint/complexity -- one client coordinator owns the transient studio session
export const StudioApp = ({
  houseSpec,
  onNewChat,
  onOpenSlug,
  onOpenThread,
  openSlug = null,
  recordedSessionId = null,
  thread = "default",
}: {
  houseSpec: OverviewSpec;
  onNewChat: () => void;
  onOpenSlug: (item: CampaignItem) => void;
  onOpenThread: (thread: StudioThread) => void;
  openSlug?: string | null;
  /** The session the workbench recorded for this concept, when reopening one. */
  recordedSessionId?: string | null;
  thread?: string;
}) => {
  const [text, setText] = useState("");
  const [uploads, setUploads] = useState<File[]>([]);
  const [libraryRefs, setLibraryRefs] = useState<StudioAttachment[]>([]);
  const [inspectorPinned, setInspectorPinned] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [versions, setVersions] = useState<StudioVersion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [finish, setFinish] = useState<StudioFinish>("outlined");
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [pending, setPending] = useState<"questions" | null>(null);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("focus");
  /**
   * The backlog, until this session has drawn something of its own. A finished
   * draw switches to `versions` on arrival, so this value is only ever what an
   * empty session opens on — and an empty session has no versions to rail.
   */
  const [inspectorView, setInspectorView] = useState<InspectorView>("backlog");
  /**
   * Comments appear in no eve event, so the durable stream cannot rebuild them.
   * They are text and two normalised numbers, so they keep their own slot
   * rather than quietly disappearing on the next reload.
   */
  const [annotations, setAnnotations] = useState<StudioAnnotation[]>(
    () =>
      (typeof window === "undefined"
        ? undefined
        : readStudioAnnotations<StudioAnnotation[]>(thread)) ?? [],
  );

  useEffect(() => {
    writeStudioAnnotations(thread, annotations);
  }, [annotations, thread]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [annotationMode, setAnnotationMode] = useState(false);
  const [activeActivities, setActiveActivities] = useState<StudioActivity[]>([]);
  const [resultDelivered, setResultDelivered] = useState(false);
  const activityRef = useRef<StudioActivity[]>([]);
  /** eve's lifecycle rows, keyed by id and upserted one at a time. */
  const lifecycleRef = useRef<StudioActivity[]>([]);
  /** The pipeline's rows, replaced wholesale from each `action.partial`. */
  const pipelineRef = useRef<StudioActivity[]>([]);
  const assistantTurnIdRef = useRef<string | null>(null);
  const pendingRequestRef = useRef<StudioRequest | null>(null);
  const processedEventIdsRef = useRef(new Set<string>());
  const resultDeliveredRef = useRef(false);
  /** True only between a send and the turn it started settling. */
  const sendInFlightRef = useRef(false);
  /**
   * True once this live turn has a specific outcome: a parsed pipeline result,
   * a named pipeline failure, or a stream error. `onFinish` must not replace
   * that with the generic empty-canvas banner.
   */
  const turnHandledRef = useRef(false);
  /** One automatic resend when the model replies without calling the pipeline. */
  const pipelineNudgeRef = useRef(false);
  /** One reconnect when the live stream closed while the pipeline was running. */
  const pipelineResumeRef = useRef(false);
  const sendRef = useRef<(payload: StudioRequest) => Promise<boolean>>(() =>
    Promise.resolve(false),
  );
  const resumeRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const recoverDroppedStream = async () => {
    try {
      await resumeRef.current();
    } catch (error) {
      sendInFlightRef.current = false;
      turnHandledRef.current = true;
      setBusy(false);
      setFault(studioFaultFromUnknown(error, "The studio could not reconnect to the drawing."));
    }
  };

  const applyStudioResponse = useCallback((body: ReturnType<typeof studioResponseSchema.parse>) => {
    const payload = pendingRequestRef.current;
    const assistantId = uid();
    assistantTurnIdRef.current = assistantId;
    resultDeliveredRef.current = true;
    setResultDelivered(true);
    /**
     * A delivered result retires whatever the last one faulted with.
     *
     * Nothing else clears it on this path: the three `setFault(null)` sites are
     * all user gestures, and the second draw after a declined attachment is
     * issued by the MODEL, not by the composer (`agent/instructions.md`: call
     * it again minus `attachments`). So the recovery the instructions call
     * correct landed a drawn icon underneath a red "Reading the attachment was
     * declined." banner and a live Try again.
     */
    setFault(null);
    if (body.kind === "questions") {
      setPending("questions");
      setTurns((current) => [
        ...current,
        {
          activities: [...activityRef.current],
          id: assistantId,
          questions: body.items,
          role: "assistant",
          text: body.text,
        },
      ]);
      return;
    }
    if (body.kind === "error") {
      setPending(null);
      setTurns((current) => [
        ...current,
        {
          activities: [...activityRef.current],
          id: assistantId,
          role: "assistant",
          text: body.text,
          tournament: body.tournament,
        },
      ]);
      return;
    }
    setPending(null);
    setVersions((current) => [...current, ...body.versions]);
    const lead = body.versions.find((row) => row.finish === payload?.finish) ?? body.versions[0];
    if (lead) {
      setSelectedId(lead.id);
      setFinish(lead.finish);
      setWorkspaceView("focus");
      setInspectorView("versions");
    }
    setTurns((current) => [
      ...current,
      {
        activities: [...activityRef.current],
        id: assistantId,
        role: "assistant",
        text: body.text,
        tournament: body.tournament,
        versions: body.versions,
      },
    ]);
  }, []);

  /**
   * Two sources feed one list, and they have to stay separable.
   *
   * eve's own lifecycle rows — session started, request accepted, the pipeline
   * call running — arrive one at a time and are keyed by id, so they upsert.
   * The pipeline's own rows arrive as a whole-list snapshot on `action.partial`,
   * whose contract is last-write-wins because the durable runtime replays; a
   * snapshot therefore replaces its half outright. Merging them in one array
   * and upserting both would make a replayed snapshot append instead of
   * replace, which is the duplicated-row bug in a new costume.
   */
  const syncActivities = () => {
    activityRef.current = [...lifecycleRef.current, ...pipelineRef.current];
    setActiveActivities(activityRef.current);

    const assistantId = assistantTurnIdRef.current;
    if (assistantId) {
      setTurns((current) =>
        current.map((turn) =>
          turn.role === "assistant" && turn.id === assistantId
            ? { ...turn, activities: [...activityRef.current] }
            : turn,
        ),
      );
    }
  };

  /**
   * What the pipeline is doing right now, for the running indicator.
   *
   * The last row still `active` is the truthful answer: the pipeline's own
   * snapshots land after eve's lifecycle rows, so the newest active row is the
   * innermost thing in flight. Falls back to a plain sentence before the first
   * snapshot arrives, because until the tool yields there is genuinely nothing
   * more specific to say.
   */
  const activePhase =
    activeActivities.toReversed().find((row) => row.state === "active")?.label ??
    "Drawing both paints";

  /** The pipeline's rows, wholesale. Idempotent under replay by construction. */
  const replacePipelineActivities = (activities: readonly StudioActivity[]) => {
    pipelineRef.current = [...activities];
    syncActivities();
  };

  const upsertActivity = (activity: StudioActivity) => {
    const index = lifecycleRef.current.findIndex((candidate) => candidate.id === activity.id);
    lifecycleRef.current =
      index === -1
        ? [...lifecycleRef.current, activity]
        : lifecycleRef.current.map((candidate, candidateIndex) =>
            candidateIndex === index ? activity : candidate,
          );
    syncActivities();
  };

  /**
   * The conversation already lives durably on the server; the studio simply
   * never reconnected to it. Reading the cursor once at mount and asking eve to
   * replay rebuilds the transcript, every version and every tournament, because
   * the same `action.result` events run the same `applyStudioResponse` path.
   */
  const savedSession = useMemo(() => {
    if (typeof window === "undefined") {
      return;
    }
    // A cursor this browser already advanced beats the campaign's recorded
    // starting point, which only knows where the workbench left off.
    const stored = readStudioSession<ClientSessionState>(thread);
    if (stored) {
      return stored;
    }
    return recordedSessionId ? { sessionId: recordedSessionId, streamIndex: 0 } : undefined;
  }, [recordedSessionId, thread]);

  const agent = useEveAgent({
    headers: studioOwnerHeaders,
    host: BASE_PATH,
    initialSession: savedSession,
    onError(error) {
      setBusy(false);
      turnHandledRef.current = true;
      setFault(studioFaultFromUnknown(error, "The studio could not reach the drawing."));
    },
    onEvent(event) {
      if (processedEventIdsRef.current.has(event.meta.id)) {
        return;
      }
      processedEventIdsRef.current.add(event.meta.id);

      const snapshot = progressSnapshot(event);
      if (snapshot) {
        replacePipelineActivities(snapshot);
      } else {
        const activity = agentActivity(event);
        if (activity) {
          upsertActivity(activity);
        }
      }

      /**
       * Rebuild the brief that caused each reply. Live sends append their own
       * user turn, but a replayed session had none, so a resumed conversation
       * showed the answers without the questions. The wire carries the request
       * envelope the agent needs; the transcript shows what the person typed.
       */
      if (event.type === "message.received" && !sendInFlightRef.current) {
        const brief = studioBriefOf(event.data.message);
        if (brief) {
          setTurns((current) => [
            ...current,
            { attachments: [], id: uid(), role: "user", text: brief },
          ]);
        }
        return;
      }

      if (event.type === "action.result" && event.data.result.kind === "tool-result") {
        if (event.data.result.toolName !== "generate_icon_pair") {
          return;
        }
        if (event.data.status === "failed" || event.data.status === "rejected") {
          /**
           * Try again replays `pendingRequestRef` verbatim, so on a decline it
           * re-submitted the very image the user just refused and tripped the
           * approval gate in `generate_icon_pair` a second time —
           * `agent/instructions.md`: "Never retry an approval the user
           * declined." Dropping the attachments leaves Try again as the draw
           * the same file calls correct: the same brief, house grammar only. A
           * `failed` pipeline is not a decline and keeps its references.
           */
          const declined = pendingRequestRef.current;
          if (event.data.status === "rejected" && declined?.attachments) {
            pendingRequestRef.current = { ...declined, attachments: undefined };
          }
          if (sendInFlightRef.current) {
            turnHandledRef.current = true;
            setFault(
              studioFaultFromUnknown(
                event.data.error,
                event.data.status === "rejected"
                  ? "Reading the attachment was declined."
                  : "The paired icon pipeline failed.",
              ),
            );
          }
          return;
        }
        const parsed = studioResponseSchema.safeParse(event.data.result.output);
        if (!parsed.success) {
          /**
           * A replayed turn can predate the current response shape: the durable
           * stream keeps what the pipeline wrote weeks ago, not what it writes
           * now. That is a record this build cannot read, not an agent fault,
           * and "Try again" cannot re-run history, so it is marked in place and
           * the rest of the session keeps replaying.
           */
          if (sendInFlightRef.current) {
            turnHandledRef.current = true;
            setFault("The icon agent returned an invalid Studio result.");
          } else {
            setTurns((current) => [
              ...current,
              {
                id: uid(),
                role: "assistant",
                text: "This turn was recorded in an older result format and cannot be shown.",
              },
            ]);
          }
          return;
        }
        applyStudioResponse(parsed.data);
      }
    },
    onFinish(snapshot) {
      const inFlight = sendInFlightRef.current;
      sendInFlightRef.current = false;
      if (!inFlight || resultDeliveredRef.current || turnHandledRef.current) {
        setBusy(false);
        return;
      }
      const diagnosis = diagnoseStudioFinish(snapshot.events);
      if (diagnosis.kind === "idle" || diagnosis.kind === "waiting") {
        setBusy(false);
        return;
      }
      const payload = pendingRequestRef.current;
      if (diagnosis.kind === "skipped" && payload && !pipelineNudgeRef.current) {
        pipelineNudgeRef.current = true;
        sendInFlightRef.current = true;
        setBusy(true);
        void sendRef.current(payload);
        return;
      }
      if (diagnosis.kind === "dropped" && !pipelineResumeRef.current) {
        pipelineResumeRef.current = true;
        sendInFlightRef.current = true;
        setBusy(true);
        void recoverDroppedStream();
        return;
      }
      turnHandledRef.current = true;
      setBusy(false);
      if (diagnosis.kind === "fault") {
        setFault(diagnosis.message);
        return;
      }
      setFault(
        diagnosis.kind === "dropped"
          ? "The drawing stream closed before a render result arrived."
          : "The icon agent finished without returning a render result.",
      );
    },
    onSessionChange(session) {
      writeStudioSession(thread, session);
    },
    resume: savedSession !== undefined,
  });

  /**
   * Pending human-in-the-loop requests, read from eve's own projection rather
   * than local state. An unrelated turn can append newer messages while an
   * approval stays open, so every message is scanned, not just the last.
   */
  const pendingRequests = agent.data.messages
    .flatMap((message) => message.parts)
    .flatMap((part) => {
      if (part.type !== "dynamic-tool" || part.state !== "approval-requested") {
        return [];
      }
      const request = part.toolMetadata?.eve?.inputRequest;
      return request ? [request] : [];
    });

  const answerRequest = async (requestId: string, answer: { optionId?: string; text?: string }) => {
    setFault(null);
    setBusy(true);
    sendInFlightRef.current = true;
    resultDeliveredRef.current = false;
    turnHandledRef.current = false;
    setResultDelivered(false);
    try {
      await agent.respond([{ requestId, ...answer }]);
    } catch (error) {
      sendInFlightRef.current = false;
      setBusy(false);
      turnHandledRef.current = true;
      setFault(studioFaultFromUnknown(error, "That answer could not reach the drawer."));
    }
  };

  /**
   * The canvas and the inspector earn their column by having something in it.
   * Before the first draw they would be two panes explaining that they are
   * empty, so the brief gets the whole window until a version lands. The
   * inspector can also be summoned early, because the reference library is
   * useful before there is anything to inspect.
   */
  const overview = useMemo(() => {
    const tournaments = turns.flatMap((turn) =>
      turn.role === "assistant" && turn.tournament ? [turn.tournament] : [],
    );
    const subjects = overviewSubjects(versions, tournaments);
    return { rows: buildOverview(subjects, houseSpec), total: subjects.length };
  }, [houseSpec, turns, versions]);

  /**
   * A conversation is called what its first brief called it. Until there is
   * one, it is unnamed rather than given a placeholder that would then have to
   * be corrected.
   */
  const threadTitle =
    turns.find((turn) => turn.role === "user")?.text.trim() || openSlug || "New chat";

  useEffect(() => {
    // Only a conversation that has said something is worth listing.
    if (turns.length === 0) {
      return;
    }
    recordThread({
      id: thread,
      kind: openSlug ? "campaign" : "chat",
      title: threadTitle,
      updatedAt: Date.now(),
      ...(openSlug ? { slug: openSlug } : {}),
    });
  }, [openSlug, thread, threadTitle, turns.length]);

  const hasWork = versions.length > 0;
  /**
   * The inspector is where the backlog lives, and the backlog is the one panel
   * whose whole purpose is reaching work that already exists. Gating it on this
   * session having drawn something made a cold start hide every icon the
   * workbench had ever drawn, reachable only through a button about reference
   * libraries. A campaign with drawn work is reason enough to show the rail.
   */
  const campaign = useCampaign();
  const inspectorVisible = hasWork || inspectorPinned || hasDrawnWork(campaign.items);

  const [firstVersion] = versions;
  const selectedVersion = versions.find((row) => row.id === selectedId);
  const selected =
    versions.find((row) => row.batchId === selectedVersion?.batchId && row.finish === finish) ??
    versions.find((row) => row.finish === finish) ??
    firstVersion ??
    null;

  const lastName = versions.at(-1)?.name;
  const lastAssistant = turns.findLast((turn) => turn.role === "assistant");
  const lastUser = turns.findLast((turn) => turn.role === "user");
  const referenceFiles = lastUser?.attachments ?? libraryRefs;
  /**
   * The brief the user actually typed. Resubmitting `lastName` instead sends
   * the *drawn icon's* name, and on a first turn there is no drawn icon, so the
   * text became the literal "icon" — which `conceptOf` reads as vague and
   * answers with the clarification questionnaire. Approving an attachment threw
   * the sentence away and asked what to draw.
   */
  const lastBrief = lastUser?.text ?? lastName;

  /**
   * Comments belong to the version they were drawn on. Every submit path has to
   * filter them, not just this one, or a note written on one variant steers the
   * refinement of an unrelated one.
   */
  const annotationsFor = (versionId: string | undefined): StudioAnnotation[] =>
    versionId
      ? annotations.filter(
          (annotation) => annotation.versionId === versionId && annotation.text.trim().length > 0,
        )
      : [];

  const send = async (payload: StudioRequest): Promise<boolean> => {
    setBusy(true);
    setFault(null);
    setActiveActivities([]);
    activityRef.current = [];
    assistantTurnIdRef.current = null;
    pendingRequestRef.current = payload;
    resultDeliveredRef.current = false;
    sendInFlightRef.current = true;
    turnHandledRef.current = false;
    setResultDelivered(false);
    try {
      await agent.send(`STUDIO_REQUEST\n${JSON.stringify(payload)}`);
      return true;
    } catch (error) {
      sendInFlightRef.current = false;
      turnHandledRef.current = true;
      setBusy(false);
      setFault(studioFaultFromUnknown(error, "The studio could not reach the drawer."));
      return false;
    }
  };
  useEffect(() => {
    sendRef.current = send;
    resumeRef.current = () => agent.resume();
  });

  /** Replays the last request so a failed draw is one click from recovery. */
  const retryLast = async () => {
    const last = pendingRequestRef.current;
    if (last && !busy) {
      pipelineNudgeRef.current = false;
      pipelineResumeRef.current = false;
      await send(last);
    }
  };

  const submitPrompt = async () => {
    const next = text.trim();
    if (!next || busy) {
      return;
    }
    let attachments: StudioAttachment[];
    try {
      attachments = [...(await Promise.all(uploads.map(readFile))), ...libraryRefs];
    } catch (error) {
      setFault(error instanceof Error ? error.message : "Could not read that file.");
      return;
    }
    setTurns((current) => [...current, { attachments, id: uid(), role: "user", text: next }]);
    pipelineNudgeRef.current = false;
    pipelineResumeRef.current = false;
    const accepted = await send({
      annotations: annotationsFor(selected?.id),
      attachments,
      finish,
      lastName,
      text: next,
    });
    // Clearing before the send meant a failed draw left the composer empty and
    // the work only recoverable by retyping it.
    if (accepted) {
      setText("");
      setUploads([]);
      setLibraryRefs([]);
    }
  };

  /** Rejects oversized files at the point of attaching, not at submit. */
  const acceptFiles = (next: File[]) => {
    const tooBig = next.find((file) => file.size > MAX_ATTACHMENT_BYTES);
    if (tooBig) {
      setFault(`${tooBig.name} is over 1.5MB.`);
      setUploads(next.filter((file) => file.size <= MAX_ATTACHMENT_BYTES));
      return;
    }
    setFault(null);
    setUploads(next);
  };

  const addLibraryReference = (attachment: StudioAttachment) => {
    setLibraryRefs((current) =>
      current.some((row) => attachmentKey(row) === attachmentKey(attachment))
        ? current
        : [...current, attachment].slice(0, 4),
    );
    setText((current) => current || attachment.name);
  };

  const selectVersion = (id: string) => {
    const row = versions.find((version) => version.id === id);
    setSelectedId(id);
    setSelectedAnnotationId(null);
    setAnnotationMode(false);
    if (row) {
      setFinish(row.finish);
    }
  };

  const addAnnotation = ({ x, y }: { x: number; y: number }) => {
    if (!selected) {
      return;
    }
    const annotation: StudioAnnotation = {
      id: uid(),
      text: "",
      versionId: selected.id,
      x: Math.max(0, Math.min(100, x)),
      y: Math.max(0, Math.min(100, y)),
    };
    setAnnotations((current) => [...current, annotation]);
    setSelectedAnnotationId(annotation.id);
    setAnnotationMode(false);
    setInspectorView("comments");
  };

  return (
    <StudioWorkspace
      canvas={
        hasWork ? (
          <section className="flex h-full min-w-0 flex-col overflow-hidden bg-background">
            <header className="flex flex-wrap items-center gap-1 border-b px-4 py-2">
              <div className="flex gap-1" role="tablist" aria-label="Canvas view">
                <Button
                  aria-selected={workspaceView === "focus"}
                  onClick={() => setWorkspaceView("focus")}
                  role="tab"
                  size="sm"
                  type="button"
                  variant={workspaceView === "focus" ? "outline" : "ghost"}
                >
                  Focus
                </Button>
                <Button
                  aria-selected={workspaceView === "explorations"}
                  onClick={() => setWorkspaceView("explorations")}
                  role="tab"
                  size="sm"
                  type="button"
                  variant={workspaceView === "explorations" ? "outline" : "ghost"}
                >
                  Explorations
                </Button>
                <Button
                  aria-selected={workspaceView === "overviews"}
                  onClick={() => setWorkspaceView("overviews")}
                  role="tab"
                  size="sm"
                  type="button"
                  variant={workspaceView === "overviews" ? "outline" : "ghost"}
                >
                  Overviews
                </Button>
              </div>
              {workspaceView === "focus" ? (
                <div className="ml-auto flex flex-wrap justify-end gap-1">
                  <Button
                    aria-pressed={annotationMode}
                    disabled={!selected}
                    onClick={() => setAnnotationMode(!annotationMode)}
                    size="sm"
                    type="button"
                    variant={annotationMode ? "outline" : "ghost"}
                  >
                    {annotationMode ? "Click the icon" : "Comment"}
                  </Button>
                  {(["outlined", "filled"] as const).map((paint) => (
                    <Button
                      aria-pressed={finish === paint}
                      key={paint}
                      onClick={() => setFinish(paint)}
                      size="sm"
                      type="button"
                      variant={finish === paint ? "default" : "ghost"}
                    >
                      {paint}
                    </Button>
                  ))}
                </div>
              ) : null}
            </header>
            <div className="flex min-h-0 flex-1 flex-col p-4 sm:p-6">
              {workspaceView === "focus" ? (
                <IconStage
                  annotationMode={annotationMode}
                  annotations={annotations}
                  onAnnotate={addAnnotation}
                  onSelectAnnotation={(id) => {
                    setSelectedAnnotationId(id);
                    setInspectorView("comments");
                  }}
                  selectedAnnotationId={selectedAnnotationId}
                  version={selected}
                />
              ) : null}
              {workspaceView === "explorations" ? (
                <ExplorationBoard
                  onSelect={(id) => {
                    selectVersion(id);
                    setWorkspaceView("focus");
                  }}
                  selectedId={selected?.id ?? null}
                  versions={versions}
                />
              ) : null}
              {workspaceView === "overviews" ? (
                <OverviewTable rows={overview.rows} total={overview.total} />
              ) : null}
            </div>
          </section>
        ) : null
      }
      chat={
        <section className="flex h-full min-w-0 flex-col overflow-hidden bg-background">
          <ChatSwitcher
            onNew={onNewChat}
            onOpen={onOpenThread}
            threadId={thread}
            title={threadTitle}
          />
          {/* `scroll-fade` belongs on the scroll container, which is
              `MessageScroller` itself — `MessageScrollerContent` is the column
              inside it and does not scroll.

              `justify-end` is what makes a short thread sit on the composer
              instead of floating at the top of a tall pane: the content is the
              flex child that grows, so without it a two-turn conversation left
              several hundred pixels of blank between itself and the input. Long
              threads are unaffected — once the content exceeds the container it
              scrolls, and the scroller stays anchored at the bottom. */}
          <MessageScroller className="scroll-fade">
            <MessageScrollerContent className="flex-1 justify-end px-4 py-4">
              {turns.length === 0 ? (
                <div className="flex flex-1 flex-col justify-center gap-4">
                  <h2 className="font-heading font-medium text-base">Start with the object noun</h2>
                  <p className="max-w-[46ch] text-base text-muted-foreground sm:text-sm">
                    Type <code className="font-mono text-foreground">wifi</code> or{" "}
                    <code className="font-mono text-foreground">a tray for mail</code>. Attach a
                    reference if you have one; I will not trace it. Chat after a draw to intervene.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {SUGGESTIONS.map((name) => (
                      <Button
                        key={name}
                        onClick={() => {
                          setText(name);
                        }}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {name}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}

              {turns.map((turn) =>
                turn.role === "user" ? (
                  <Message align="end" key={turn.id}>
                    <MessageContent>
                      <MessageHeader>You</MessageHeader>
                      {turn.attachments.length > 0 ? (
                        <AttachmentGroup>
                          {turn.attachments.map((file) => (
                            <Attachment key={attachmentKey(file)} orientation="vertical" size="sm">
                              <AttachmentMedia variant={file.dataUrl ? "image" : "icon"}>
                                {file.dataUrl ? (
                                  // oxlint-disable-next-line nextjs/no-img-element -- user attachment preview
                                  <img alt="" src={file.dataUrl} />
                                ) : (
                                  <Paperclip />
                                )}
                              </AttachmentMedia>
                              <AttachmentContent>
                                <AttachmentTitle>{file.name}</AttachmentTitle>
                              </AttachmentContent>
                            </Attachment>
                          ))}
                        </AttachmentGroup>
                      ) : null}
                      <Bubble align="end">
                        <BubbleContent>{turn.text}</BubbleContent>
                      </Bubble>
                    </MessageContent>
                  </Message>
                ) : (
                  <Message key={turn.id}>
                    <MessageContent>
                      <MessageHeader>Iconsmith</MessageHeader>
                      {turn.activities ? <AgentActivityCard activities={turn.activities} /> : null}
                      <Bubble variant="muted">
                        <BubbleContent>{turn.text}</BubbleContent>
                      </Bubble>
                      {turn.versions || turn.tournament ? (
                        <ThinkingCard tournament={turn.tournament} versions={turn.versions ?? []} />
                      ) : null}
                      {turn.questions ? (
                        <Questionnaire
                          items={[...turn.questions]}
                          onSubmit={async () => {
                            pipelineNudgeRef.current = false;
                            pipelineResumeRef.current = false;
                            await send({
                              annotations: annotationsFor(selected?.id),
                              answers,
                              attachments: [...referenceFiles],
                              finish,
                              lastName,
                              text:
                                typeof answers.object === "string" &&
                                answers.object.trim().length > 0
                                  ? answers.object
                                  : (lastBrief ?? "icon"),
                            });
                          }}
                          onValueChange={setAnswers}
                          value={answers}
                        >
                          <QuestionnaireProgress />
                          <QuestionnaireTitle />
                          <QuestionnaireDescription />
                          <QuestionnaireChoices />
                          <QuestionnaireFreeform />
                          <QuestionnaireActions />
                        </Questionnaire>
                      ) : null}
                    </MessageContent>
                  </Message>
                ),
              )}

              {busy && !resultDelivered ? (
                <AgentActivityCard activities={activeActivities} />
              ) : null}
              {busy && !resultDelivered ? (
                /* The indicator says what the pipeline is doing, taken from the
                   active step rather than from a decorative word cycle: with
                   real progress arriving, "arm 3 of 8, reviewing the filled
                   paint" is worth more than a rotating list of gerunds. One
                   word means it shimmers without cycling, which is the honest
                   reading when there is exactly one thing happening. Once the
                   render result arrives, Eve may still be closing the model's
                   turn for a moment, but the drawing is no longer in flight.

                   It renders its own `<output>`, so it is a live region
                   already — wrapping it in another would nest two. */
                <ThinkingIndicator words={[activePhase]} />
              ) : null}
              {pendingRequests.map((request) => (
                <div
                  className="flex max-w-lg flex-col gap-3 rounded-xl border bg-card p-4"
                  key={request.requestId}
                >
                  <h3 className="font-heading font-medium text-lg">{requestTitle(request.kind)}</h3>
                  <p className="text-base text-muted-foreground sm:text-sm">
                    {requestBody(request)}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {(request.options ?? []).map((option) => (
                      <Button
                        key={option.id}
                        onClick={() => answerRequest(request.requestId, { optionId: option.id })}
                        type="button"
                        variant={option.style === "danger" ? "ghost" : "outline"}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                  {request.allowFreeform ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        const value = String(
                          new FormData(event.currentTarget).get("answer") ?? "",
                        ).trim();
                        if (value) {
                          void answerRequest(request.requestId, { text: value });
                        }
                      }}
                    >
                      <Textarea
                        aria-label={request.prompt}
                        className="min-h-16"
                        name="answer"
                        placeholder="Type an answer"
                      />
                      <Button className="mt-2" size="sm" type="submit" variant="outline">
                        Send answer
                      </Button>
                    </form>
                  ) : null}
                </div>
              ))}
              {fault ? (
                <Marker role="alert">
                  <MarkerContent className="flex flex-wrap items-center gap-3">
                    <span>{fault}</span>
                    <span className="text-muted-foreground">Your brief is still here.</span>
                    <Button disabled={busy} onClick={retryLast} size="sm" variant="outline">
                      Try again
                    </Button>
                  </MarkerContent>
                </Marker>
              ) : null}
            </MessageScrollerContent>
          </MessageScroller>

          <div className="border-t px-3 pt-3 pb-5">
            <div className="mx-auto w-full max-w-3xl">
              {libraryRefs.length > 0 ? (
                /* Library references carry a name and a licence, never geometry,
                 so they read as text rather than as a picture of an icon. */
                <ul className="flex flex-wrap gap-1.5 pb-2">
                  {libraryRefs.map((ref) => (
                    <li key={attachmentKey(ref)}>
                      <span className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
                        {ref.name}
                        <span className="text-muted-foreground">{ref.source}</span>
                        <button
                          aria-label={`Remove ${ref.name}`}
                          className="text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                          onClick={() =>
                            setLibraryRefs((current) =>
                              current.filter((row) => attachmentKey(row) !== attachmentKey(ref)),
                            )
                          }
                          type="button"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <InputMessage
                accept="image/*,.svg,.json,.txt"
                disabled={busy}
                files={uploads}
                leftSlot={
                  inspectorVisible ? null : (
                    <Button
                      onClick={() => {
                        setInspectorPinned(true);
                        setInspectorView("library");
                      }}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      Browse reference libraries
                    </Button>
                  )
                }
                /* The two reference sources share one budget of 4, and the
                   schema rejects the union above it. `LibraryBrowser` already
                   counts uploads through `full`; without the mirror of that
                   here, four library refs plus four files reached eight and
                   failed zod as a generic banner at submit. */
                maxFiles={4 - libraryRefs.length}
                onFilesChange={acceptFiles}
                onSend={submitPrompt}
                onStop={
                  busy
                    ? async () => {
                        try {
                          await agent.cancel();
                          turnHandledRef.current = true;
                          sendInFlightRef.current = false;
                          setBusy(false);
                        } catch (error) {
                          // A failed cancel may leave paid work in flight. Keep
                          // the Stop control available and say what happened;
                          // presenting an idle composer here would be a lie.
                          setFault(
                            studioFaultFromUnknown(error, "The Studio could not stop this run."),
                          );
                        }
                      }
                    : undefined
                }
                onValueChange={setText}
                placeholder={promptHint(
                  pending,
                  Boolean(lastAssistant),
                  pendingRequests.length > 0,
                )}
                sendLabel="Draw"
                stopLabel="Stop drawing"
                value={text}
              />
            </div>
          </div>
        </section>
      }
      inspector={
        inspectorVisible ? (
          <aside className="flex h-full min-w-0 flex-col overflow-hidden bg-card">
            <div
              aria-label="Studio inspector"
              className="flex gap-1 overflow-x-auto border-b p-2"
              role="tablist"
            >
              <Button
                aria-selected={inspectorView === "versions"}
                onClick={() => setInspectorView("versions")}
                role="tab"
                size="sm"
                type="button"
                variant={inspectorView === "versions" ? "outline" : "ghost"}
              >
                Versions
              </Button>
              <Button
                aria-selected={inspectorView === "library"}
                onClick={() => setInspectorView("library")}
                role="tab"
                size="sm"
                type="button"
                variant={inspectorView === "library" ? "outline" : "ghost"}
              >
                Library
              </Button>
              <Button
                aria-selected={inspectorView === "comments"}
                onClick={() => setInspectorView("comments")}
                role="tab"
                size="sm"
                type="button"
                variant={inspectorView === "comments" ? "outline" : "ghost"}
              >
                Comments
              </Button>
              <Button
                aria-selected={inspectorView === "backlog"}
                onClick={() => setInspectorView("backlog")}
                role="tab"
                size="sm"
                type="button"
                variant={inspectorView === "backlog" ? "outline" : "ghost"}
              >
                Backlog
              </Button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col p-4">
              {inspectorView === "versions" ? (
                <VersionRail
                  onSelect={selectVersion}
                  selectedId={selected?.id ?? null}
                  versions={versions}
                />
              ) : null}
              {inspectorView === "library" ? (
                <LibraryBrowser
                  attached={libraryRefs.map((ref) => ref.name)}
                  full={libraryRefs.length + uploads.length >= 4}
                  onAttach={addLibraryReference}
                />
              ) : null}
              {inspectorView === "backlog" ? (
                <CampaignPanel
                  fault={campaign.fault}
                  items={campaign.items}
                  onOpen={onOpenSlug}
                  openSlug={openSlug}
                />
              ) : null}
              {inspectorView === "comments" ? (
                <AnnotationPanel
                  annotations={annotations}
                  onDelete={(id) => {
                    setAnnotations((current) =>
                      current.filter((annotation) => annotation.id !== id),
                    );
                    setSelectedAnnotationId((current) => (current === id ? null : current));
                  }}
                  /* The comment is only in memory, so undo is honest here — cheaper
                   for the user than a confirm dialog on every delete. */
                  onRestore={(annotation) => {
                    setAnnotations((current) =>
                      current.some((row) => row.id === annotation.id)
                        ? current
                        : [...current, annotation],
                    );
                  }}
                  onRefine={(open) => {
                    if (!selected) {
                      return;
                    }
                    setText(`Refine ${selected.name}: ${open.map((item) => item.text).join("; ")}`);
                  }}
                  onSelect={setSelectedAnnotationId}
                  onTextChange={(id, next) =>
                    setAnnotations((current) =>
                      current.map((annotation) =>
                        annotation.id === id ? { ...annotation, text: next } : annotation,
                      ),
                    )
                  }
                  selectedId={selectedAnnotationId}
                  version={selected}
                />
              ) : null}
            </div>
          </aside>
        ) : null
      }
    />
  );
};
