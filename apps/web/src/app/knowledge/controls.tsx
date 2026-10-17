/** @file controls.tsx @description Accessible, compact knowledge workspace form controls. */
import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import type {
  SelectHTMLAttributes,
  InputHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { Input as ShadcnInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select as ShadcnSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea as ShadcnTextarea } from "@/components/ui/textarea";

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactElement<{ id?: string }>;
}) {
  const id = useId();
  return (
    <div className="grid gap-1 text-sm font-medium">
      <Label htmlFor={id}>{label}</Label>
      {cloneElement(children, { id })}
    </div>
  );
}

type OptionElement = ReactElement<{
  value?: string;
  disabled?: boolean;
  children?: ReactNode;
}>;

function optionValue(option: OptionElement) {
  if (option.props.value !== undefined) return String(option.props.value);
  if (typeof option.props.children === "string") return option.props.children;
  return String(option.key ?? "");
}

function optionLabel(option: OptionElement) {
  return option.props.children;
}

/** ShadCN select adapter retaining the native select props used by knowledge forms. */
export function Select({
  children,
  value,
  defaultValue,
  onChange,
  className,
  id,
  name,
  disabled,
  required,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const options = Children.toArray(children).filter(isValidElement) as OptionElement[];
  const initialValue = String(value ?? defaultValue ?? "");
  const selectedOption = options.find((option) => optionValue(option) === initialValue);
  const placeholder = options.find((option) => optionValue(option) === "");
  const triggerLabel = selectedOption
    ? optionLabel(selectedOption)
    : placeholder
      ? optionLabel(placeholder)
      : "Chọn một mục";
  const handleValueChange = (nextValue: string | null) => {
    const next = nextValue ?? "";
    onChange?.({ target: { value: next }, currentTarget: { value: next } } as ChangeEvent<HTMLSelectElement>);
  };

  return (
    <>
      <ShadcnSelect
        value={initialValue || undefined}
        defaultValue={defaultValue ? String(defaultValue) : undefined}
        onValueChange={handleValueChange}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          className={`w-full ${className ?? ""}`}
          aria-required={required || undefined}
          {...(props as Record<string, unknown>)}
        >
          <SelectValue>{triggerLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options
            .filter((option) => optionValue(option) !== "")
            .map((option) => (
              <SelectItem key={optionValue(option)} value={optionValue(option)} disabled={option.props.disabled}>
                {optionLabel(option)}
              </SelectItem>
            ))}
        </SelectContent>
      </ShadcnSelect>
      {name && <input type="hidden" name={name} value={initialValue} required={required} readOnly />}
    </>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <ShadcnInput {...props} className={props.className} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <ShadcnTextarea {...props} className={props.className} />;
}
export function ErrorMessage({ error }: { error: unknown }) {
  return error ? (
    <p
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
    >
      {error instanceof Error
        ? error.message
        : "Không thể tải dữ liệu. Hãy thử lại."}
    </p>
  ) : null;
}
