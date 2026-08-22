export type StudioFinish = "outlined" | "filled";

export interface StudioAttachment {
  readonly dataUrl?: string;
  readonly kind: "image" | "svg" | "file";
  readonly name: string;
  readonly size: number;
  readonly type: string;
}

export interface StudioIssue {
  readonly message: string;
  readonly rule: string;
  readonly severity: "error" | "warn";
}

export interface StudioVersion {
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
