"use client";

import Focus from "blode-icons-react/icons/focus";
import Grid from "blode-icons-react/icons/layers-three";
import Library from "blode-icons-react/icons/library";
import PaperPlane from "blode-icons-react/icons/paper-plane";
import Paperclip from "blode-icons-react/icons/paperclip-1";
import ChatBubbles from "blode-icons-react/icons/chat-bubbles";
import X from "blode-icons-react/icons/x";
import { useId, useRef, useState } from "react";

import { AnnotationPanel } from "@/components/studio/annotation-panel";
import { ExplorationBoard } from "@/components/studio/exploration-board";
import { IconStage } from "@/components/studio/icon-stage";
import { LibraryBrowser } from "@/components/studio/library-browser";
import { ThinkingCard } from "@/components/studio/thinking-card";
import { VersionRail } from "@/components/studio/version-rail";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Marker, MarkerContent } from "@/components/ui/marker";
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
import { Textarea } from "@/components/ui/textarea";
import { asset } from "@/lib/site-url";
import type {
  StudioApproval,
  StudioAnnotation,
  StudioAttachment,
  StudioFinish,
  StudioQuestion,
  StudioRequest,
  StudioResponse,
  StudioVersion,
} from "@/lib/studio/types";

type Turn =
  | {
      attachments: readonly StudioAttachment[];
      id: string;
      role: "user";
      text: string;
    }
  | {
      approval?: StudioApproval;
      id: string;
      questions?: readonly StudioQuestion[];
      role: "assistant";
      text: string;
      versions?: readonly StudioVersion[];
    };

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

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
  if (file.size > 1_500_000) {
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

const attachmentKey = (file: StudioAttachment) => `${file.source ?? "local"}:${file.name}`;

type WorkspaceView = "focus" | "explorations";
type InspectorView = "versions" | "library" | "comments";

const SUGGESTIONS = ["wifi", "inbox", "briefcase", "umbrella", "qr-code", "home"];

const promptHint = (pending: "questions" | "approval" | null, intervening: boolean): string => {
  if (pending === "questions") {
    return "Answer the questions, or type the object noun";
  }
  if (intervening) {
    return "Intervene — taller handle, filled, try inbox…";
  }
  return "wifi, a tray for mail, briefcase…";
};

// oxlint-disable-next-line eslint/complexity -- one client coordinator owns the transient studio session
export const StudioApp = () => {
  const fileId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<StudioAttachment[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [versions, setVersions] = useState<StudioVersion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [finish, setFinish] = useState<StudioFinish>("outlined");
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [pending, setPending] = useState<"questions" | "approval" | null>(null);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("focus");
  const [inspectorView, setInspectorView] = useState<InspectorView>("versions");
  const [annotations, setAnnotations] = useState<StudioAnnotation[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [annotationMode, setAnnotationMode] = useState(false);

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
  const referenceFiles = lastUser?.attachments ?? files;

  const send = async (payload: StudioRequest) => {
    setBusy(true);
    setFault(null);
    try {
      const response = await fetch(asset("/api/studio"), {
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const body = (await response.json()) as StudioResponse;
      if (body.kind === "questions") {
        setPending("questions");
        setTurns((current) => [
          ...current,
          { id: uid(), questions: body.items, role: "assistant", text: body.text },
        ]);
        return;
      }
      if (body.kind === "approval") {
        setPending("approval");
        setTurns((current) => [
          ...current,
          { approval: body.approval, id: uid(), role: "assistant", text: body.text },
        ]);
        return;
      }
      if (body.kind === "error") {
        setPending(null);
        setTurns((current) => [...current, { id: uid(), role: "assistant", text: body.text }]);
        return;
      }
      setPending(null);
      setVersions((current) => [...current, ...body.versions]);
      const lead = body.versions.find((row) => row.finish === payload.finish) ?? body.versions[0];
      if (lead) {
        setSelectedId(lead.id);
        setFinish(lead.finish);
        setWorkspaceView("focus");
        setInspectorView("versions");
      }
      setTurns((current) => [
        ...current,
        { id: uid(), role: "assistant", text: body.text, versions: body.versions },
      ]);
    } catch (error) {
      setFault(error instanceof Error ? error.message : "The studio could not reach the drawer.");
    } finally {
      setBusy(false);
    }
  };

  const submitPrompt = async () => {
    const next = text.trim();
    if (!next || busy) {
      return;
    }
    const attachments = files;
    setTurns((current) => [...current, { attachments, id: uid(), role: "user", text: next }]);
    setText("");
    setFiles([]);
    await send({
      annotations: selected
        ? annotations.filter(
            (annotation) =>
              annotation.versionId === selected.id && annotation.text.trim().length > 0,
          )
        : [],
      attachments,
      finish,
      lastName,
      text: next,
    });
  };

  const addFiles = async (list: FileList | null) => {
    if (!list) {
      return;
    }
    try {
      const next = await Promise.all([...list].slice(0, 4 - files.length).map(readFile));
      setFiles((current) => [...current, ...next].slice(0, 4));
    } catch (error) {
      setFault(error instanceof Error ? error.message : "Could not attach that file.");
    }
  };

  const addLibraryReference = (attachment: StudioAttachment) => {
    setFiles((current) => {
      if (current.some((file) => attachmentKey(file) === attachmentKey(attachment))) {
        return current;
      }
      return [...current, attachment].slice(0, 4);
    });
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
    <div className="grid min-h-0 flex-1 overflow-hidden rounded-2xl border bg-border lg:grid-cols-[22rem_minmax(0,1fr)] xl:h-[calc(100svh-7rem)] xl:min-h-[42rem] xl:flex-none xl:grid-cols-[22rem_minmax(0,1fr)_19rem]">
      <section className="flex min-h-[38rem] min-w-0 flex-col bg-background lg:border-r">
        <header className="flex flex-col gap-1 border-b px-4 py-3">
          <h2 className="font-medium">Chat</h2>
          <p className="text-base text-muted-foreground sm:text-sm">
            Brief, references, and branches
          </p>
        </header>
        <MessageScroller>
          <MessageScrollerContent className="max-w-none">
            {turns.length === 0 ? (
              <div className="flex flex-col gap-4">
                <Marker variant="separator">
                  <MarkerContent>Start with the object noun</MarkerContent>
                </Marker>
                <p className="max-w-[46ch] text-base text-muted-foreground sm:text-sm">
                  Type <code className="font-mono text-foreground">wifi</code> or{" "}
                  <code className="font-mono text-foreground">a tray for mail</code>. Attach a
                  reference if you have one — I will not trace it. Chat after a draw to intervene.
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
                    <Bubble variant="muted">
                      <BubbleContent>{turn.text}</BubbleContent>
                    </Bubble>
                    {turn.versions ? <ThinkingCard versions={turn.versions} /> : null}
                    {turn.questions ? (
                      <Questionnaire
                        items={[...turn.questions]}
                        onSubmit={async () => {
                          await send({
                            annotations,
                            answers,
                            attachments: referenceFiles,
                            finish,
                            lastName,
                            pending: "questions",
                            text:
                              typeof answers.object === "string"
                                ? answers.object
                                : (lastName ?? "icon"),
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
                    {turn.approval ? (
                      <div className="flex max-w-lg flex-col gap-3 rounded-xl border bg-card p-4">
                        <h3 className="font-heading font-medium text-lg">{turn.approval.title}</h3>
                        <p className="text-base text-muted-foreground sm:text-sm">
                          {turn.approval.body}
                        </p>
                        <div className="flex gap-2">
                          <Button
                            disabled={busy}
                            onClick={async () => {
                              await send({
                                annotations,
                                approved: false,
                                attachments: referenceFiles,
                                finish,
                                lastName,
                                pending: "approval",
                                text: lastName ?? "icon",
                              });
                            }}
                            type="button"
                            variant="ghost"
                          >
                            Leave it out
                          </Button>
                          <Button
                            disabled={busy}
                            onClick={async () => {
                              await send({
                                annotations,
                                approved: true,
                                attachments: referenceFiles,
                                finish,
                                lastName,
                                pending: "approval",
                                text: lastName ?? "icon",
                              });
                            }}
                            type="button"
                            variant="outline"
                          >
                            Approve
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </MessageContent>
                </Message>
              ),
            )}

            {busy ? (
              <Marker asChild>
                <output aria-atomic="true" aria-live="polite">
                  <MarkerContent className="animate-pulse">
                    Agent pipeline running — drawing both paints, rendering, and visually reviewing.
                  </MarkerContent>
                </output>
              </Marker>
            ) : null}
            {fault ? (
              <Marker role="alert">
                <MarkerContent>{fault}</MarkerContent>
              </Marker>
            ) : null}
          </MessageScrollerContent>
        </MessageScroller>

        <div
          className="border-t p-3"
          onDragOver={(event) => event.preventDefault()}
          onDrop={async (event) => {
            event.preventDefault();
            await addFiles(event.dataTransfer.files);
          }}
        >
          {files.length > 0 ? (
            <AttachmentGroup className="pb-3">
              {files.map((file) => (
                <Attachment key={attachmentKey(file)} size="sm">
                  <AttachmentMedia variant={file.dataUrl ? "image" : "icon"}>
                    {file.dataUrl ? (
                      // oxlint-disable-next-line nextjs/no-img-element -- local attachment chip
                      <img alt="" src={file.dataUrl} />
                    ) : (
                      <Paperclip />
                    )}
                  </AttachmentMedia>
                  <AttachmentContent>
                    <AttachmentTitle>{file.name}</AttachmentTitle>
                    <AttachmentDescription>
                      {file.source ? `${file.source} · name only` : file.kind}
                    </AttachmentDescription>
                  </AttachmentContent>
                  <AttachmentActions>
                    <AttachmentAction
                      aria-label={`Remove ${file.name}`}
                      onClick={() =>
                        setFiles((current) =>
                          current.filter((row) => attachmentKey(row) !== attachmentKey(file)),
                        )
                      }
                      type="button"
                    >
                      <X />
                    </AttachmentAction>
                  </AttachmentActions>
                </Attachment>
              ))}
            </AttachmentGroup>
          ) : null}
          <div className="flex items-end gap-2">
            <input
              accept="image/*,.svg,.json,.txt"
              className="sr-only"
              id={fileId}
              multiple
              name="attachments"
              onChange={async (event) => {
                await addFiles(event.target.files);
                event.target.value = "";
              }}
              ref={fileRef}
              type="file"
            />
            <Button
              aria-label="Attach a reference"
              onClick={() => fileRef.current?.click()}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Paperclip />
            </Button>
            <Textarea
              aria-label="Describe the icon"
              disabled={busy}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={async (event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  await submitPrompt();
                }
              }}
              placeholder={promptHint(pending, Boolean(lastAssistant))}
              name="studio-prompt"
              value={text}
            />
            <Button
              aria-label="Draw"
              disabled={busy || text.trim().length === 0}
              onClick={async () => {
                await submitPrompt();
              }}
              size="icon"
              type="button"
            >
              <PaperPlane />
            </Button>
          </div>
          <p className="px-1 pt-2 text-muted-foreground text-xs">
            Enter to draw · Shift+Enter for a new line · Drop images on this bar
          </p>
        </div>
      </section>

      <section className="flex min-h-[38rem] min-w-0 flex-col bg-background">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex flex-col gap-1">
            <h2 className="font-medium">Canvas</h2>
            <p className="text-base text-muted-foreground sm:text-sm">
              Focus at real sizes or scan every attempt
            </p>
          </div>
          <div className="flex gap-1" role="tablist" aria-label="Canvas view">
            <Button
              aria-selected={workspaceView === "focus"}
              onClick={() => setWorkspaceView("focus")}
              role="tab"
              size="sm"
              type="button"
              variant={workspaceView === "focus" ? "outline" : "ghost"}
            >
              <Focus />
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
              <Grid />
              Explorations
            </Button>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col p-4 sm:p-6">
          {workspaceView === "focus" ? (
            <IconStage
              annotationMode={annotationMode}
              annotations={annotations}
              finish={finish}
              onAnnotate={addAnnotation}
              onAnnotationModeChange={setAnnotationMode}
              onFinish={setFinish}
              onSelectAnnotation={(id) => {
                setSelectedAnnotationId(id);
                setInspectorView("comments");
              }}
              selectedAnnotationId={selectedAnnotationId}
              version={selected}
            />
          ) : (
            <ExplorationBoard
              onSelect={(id) => {
                selectVersion(id);
                setWorkspaceView("focus");
              }}
              selectedId={selected?.id ?? null}
              versions={versions}
            />
          )}
        </div>
      </section>

      <aside className="flex min-h-[24rem] min-w-0 flex-col border-t bg-card lg:col-span-2 xl:col-span-1 xl:border-t-0 xl:border-l">
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
            <Grid />
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
            <Library />
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
            <ChatBubbles />
            Comments
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
          {inspectorView === "library" ? <LibraryBrowser onAttach={addLibraryReference} /> : null}
          {inspectorView === "comments" ? (
            <AnnotationPanel
              annotations={annotations}
              onDelete={(id) => {
                setAnnotations((current) => current.filter((annotation) => annotation.id !== id));
                setSelectedAnnotationId((current) => (current === id ? null : current));
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
    </div>
  );
};
