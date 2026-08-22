export type StudioFinish = "outlined" | "filled";

export interface StudioAttachment {
  readonly dataUrl?: string;
  readonly kind: "image" | "svg" | "file" | "library";
  readonly name: string;
  readonly size: number;
  readonly source?: string;
  readonly text?: string;
  readonly type: string;
}

export interface StudioAnnotation {
  readonly id: string;
  readonly text: string;
  readonly versionId: string;
  readonly x: number;
  readonly y: number;
}

export interface StudioLibraryResult {
  readonly dataUrl: string;
  readonly id: string;
  readonly license: string;
  readonly licenseUrl: string;
  readonly name: string;
  readonly source: string;
  readonly sourceUrl: string;
}

export interface StudioLibraryResponse {
  readonly degraded?: boolean;
  readonly results: readonly StudioLibraryResult[];
}

export interface StudioIssue {
  readonly message: string;
  readonly rule: string;
  readonly severity: "error" | "warn";
}

export type StudioExpert = "agent" | "analog" | "compile" | "glyph" | "mark";

export interface StudioAgentRun {
  readonly attempted: readonly StudioExpert[];
  readonly findings: readonly { kind: string; message: string }[];
  readonly mode: "draw-and-review" | "review";
  readonly ok: boolean;
  readonly pq: number;
  readonly reason: string | null;
  readonly sc: number;
  readonly scorable: boolean;
  readonly selected: StudioExpert;
}

export interface StudioVersion {
  readonly agent: StudioAgentRun;
  readonly batchId: string;
  readonly brief: string;
  readonly clean: boolean;
  readonly finish: StudioFinish;
  readonly id: string;
  readonly issues: readonly StudioIssue[];
  readonly name: string;
  readonly program: string;
  readonly steps: number;
  readonly svg: string;
  readonly trace: readonly string[];
}

export interface StudioQuestion {
  readonly choices?: readonly { label: string; value: string }[];
  readonly description?: string;
  readonly freeform?: boolean;
  readonly id: string;
  readonly multiple?: boolean;
  readonly optional?: boolean;
  readonly title: string;
}

export interface StudioApproval {
  readonly body: string;
  readonly id: string;
  readonly title: string;
}

export interface StudioRequest {
  readonly annotations?: readonly StudioAnnotation[];
  readonly answers?: Record<string, string | string[]>;
  readonly approved?: boolean;
  readonly attachments?: readonly StudioAttachment[];
  readonly finish?: StudioFinish;
  readonly lastName?: string;
  readonly pending?: "questions" | "approval";
  readonly text: string;
}

export type StudioResponse =
  | {
      readonly approval: StudioApproval;
      readonly kind: "approval";
      readonly text: string;
    }
  | {
      readonly kind: "error";
      readonly text: string;
    }
  | {
      readonly items: readonly StudioQuestion[];
      readonly kind: "questions";
      readonly text: string;
    }
  | {
      readonly kind: "drawn";
      readonly text: string;
      readonly versions: readonly StudioVersion[];
    };
