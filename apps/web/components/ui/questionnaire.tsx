"use client";

import type * as React from "react";
import { createContext, useCallback, useContext, useId, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type QuestionnaireAnswers = Record<string, string | string[]>;

export interface QuestionnaireItem {
  readonly choices?: readonly { label: string; value: string }[];
  readonly description?: string;
  readonly freeform?: boolean;
  readonly id: string;
  readonly multiple?: boolean;
  readonly optional?: boolean;
  readonly title: string;
}

interface QuestionnaireContextValue {
  readonly answers: QuestionnaireAnswers;
  readonly current: QuestionnaireItem | undefined;
  readonly index: number;
  readonly items: readonly QuestionnaireItem[];
  readonly setAnswer: (id: string, value: string | string[]) => void;
  readonly setIndex: (index: number) => void;
}

const QuestionnaireContext = createContext<QuestionnaireContextValue | null>(null);

const useQuestionnaire = (): QuestionnaireContextValue => {
  const ctx = useContext(QuestionnaireContext);
  if (!ctx) {
    throw new Error("Questionnaire components must sit inside <Questionnaire>");
  }
  return ctx;
};

const Questionnaire = ({
  items,
  value,
  defaultValue,
  onValueChange,
  onSubmit,
  className,
  children,
  ...props
}: React.ComponentProps<"form"> & {
  defaultValue?: QuestionnaireAnswers;
  items: readonly QuestionnaireItem[];
  onValueChange?: (answers: QuestionnaireAnswers) => void;
  value?: QuestionnaireAnswers;
}) => {
  const [uncontrolled, setUncontrolled] = useState<QuestionnaireAnswers>(defaultValue ?? {});
  const [index, setIndex] = useState(0);
  const answers = value ?? uncontrolled;

  const setAnswer = useCallback(
    (id: string, next: string | string[]) => {
      const merged = { ...answers, [id]: next };
      if (value === undefined) {
        setUncontrolled(merged);
      }
      onValueChange?.(merged);
    },
    [answers, onValueChange, value],
  );

  const current = items[index];
  const context = useMemo(
    () => ({ answers, current, index, items, setAnswer, setIndex }),
    [answers, current, index, items, setAnswer],
  );

  return (
    <QuestionnaireContext.Provider value={context}>
      <form
        className={cn(
          "flex w-full max-w-lg flex-col gap-4 rounded-2xl border bg-card p-4 shadow-xs",
          className,
        )}
        data-slot="questionnaire"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit?.(event);
        }}
        {...props}
      >
        {children}
      </form>
    </QuestionnaireContext.Provider>
  );
};

const QuestionnaireProgress = ({ className, ...props }: React.ComponentProps<"p">) => {
  const { index, items } = useQuestionnaire();
  return (
    <p
      className={cn("tabular-figures text-muted-foreground text-xs", className)}
      data-slot="questionnaire-progress"
      {...props}
    >
      Question {index + 1} of {items.length}
    </p>
  );
};

const QuestionnaireTitle = ({ className, ...props }: React.ComponentProps<"h3">) => {
  const { current } = useQuestionnaire();
  return (
    <h3
      className={cn("font-heading font-medium text-lg", className)}
      data-slot="questionnaire-title"
      {...props}
    >
      {props.children ?? current?.title}
    </h3>
  );
};

const QuestionnaireDescription = ({ className, ...props }: React.ComponentProps<"p">) => {
  const { current } = useQuestionnaire();
  if (!(props.children || current?.description)) {
    return null;
  }
  return (
    <p
      className={cn("text-muted-foreground text-sm", className)}
      data-slot="questionnaire-description"
      {...props}
    >
      {props.children ?? current?.description}
    </p>
  );
};

const QuestionnaireChoices = () => {
  const { answers, current, setAnswer } = useQuestionnaire();
  const name = useId();
  if (!current?.choices?.length) {
    return null;
  }
  const selected = answers[current.id];
  const picked = new Set<string>();
  if (Array.isArray(selected)) {
    for (const value of selected) {
      picked.add(value);
    }
  } else if (selected) {
    picked.add(selected);
  }

  return (
    <div className="flex flex-col gap-2" data-slot="questionnaire-choices">
      {current.choices.map((choice) => {
        const active = picked.has(choice.value);
        return (
          <label
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors",
              active ? "border-ring bg-muted" : "border-border hover:bg-muted/50",
            )}
            key={choice.value}
          >
            <input
              checked={active}
              className="accent-foreground"
              name={name}
              onChange={() => {
                if (current.multiple) {
                  const next = new Set(picked);
                  if (active) {
                    next.delete(choice.value);
                  } else {
                    next.add(choice.value);
                  }
                  setAnswer(current.id, [...next]);
                  return;
                }
                setAnswer(current.id, choice.value);
              }}
              type={current.multiple ? "checkbox" : "radio"}
              value={choice.value}
            />
            {choice.label}
          </label>
        );
      })}
    </div>
  );
};

const QuestionnaireFreeform = () => {
  const { answers, current, setAnswer } = useQuestionnaire();
  if (!current?.freeform) {
    return null;
  }
  const value = answers[current.id];
  return (
    <div className="flex flex-col gap-2" data-slot="questionnaire-freeform">
      <Label htmlFor={current.id}>Or describe it</Label>
      <Input
        id={current.id}
        onChange={(event) => setAnswer(current.id, event.target.value)}
        placeholder="The object noun, not the intent"
        value={typeof value === "string" ? value : ""}
      />
    </div>
  );
};

const QuestionnaireActions = ({
  className,
  onSkip,
  ...props
}: React.ComponentProps<"div"> & { onSkip?: () => void }) => {
  const { current, index, items, setIndex } = useQuestionnaire();
  const last = index >= items.length - 1;

  return (
    <div
      className={cn("flex flex-wrap items-center gap-2", className)}
      data-slot="questionnaire-actions"
      {...props}
    >
      <Button
        disabled={index === 0}
        onClick={() => setIndex(index - 1)}
        size="sm"
        type="button"
        variant="ghost"
      >
        Previous
      </Button>
      {current?.optional ? (
        <Button onClick={onSkip} size="sm" type="button" variant="ghost">
          Skip
        </Button>
      ) : null}
      {last ? (
        <Button className="ml-auto" size="sm" type="submit">
          Continue
        </Button>
      ) : (
        <Button className="ml-auto" onClick={() => setIndex(index + 1)} size="sm" type="button">
          Next
        </Button>
      )}
    </div>
  );
};

export {
  Questionnaire,
  QuestionnaireProgress,
  QuestionnaireTitle,
  QuestionnaireDescription,
  QuestionnaireChoices,
  QuestionnaireFreeform,
  QuestionnaireActions,
};
