"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AuthFieldProps extends Omit<React.ComponentProps<"input">, "size"> {
  label: string;
  icon?: React.ReactNode;
  toggleable?: boolean;
}

export function AuthField({ label, icon, toggleable, id, className, type, ...props }: AuthFieldProps) {
  const [show, setShow] = useState(false);
  const inputType = toggleable ? (show ? "text" : "password") : type ?? "text";

  return (
    <div className="space-y-2">
      <Label htmlFor={id} style={{ color: "var(--foreground)" }}>
        {label}
      </Label>
      <div className="relative">
        {icon && (
          <span
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: "var(--muted-foreground)" }}
          >
            {icon}
          </span>
        )}
        <Input
          id={id}
          type={inputType}
          className={`${icon ? "pl-10" : ""} ${toggleable ? "pr-10" : ""} ${className ?? ""}`}
          style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }}
          {...props}
        />
        {toggleable && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer"
            style={{ color: "var(--muted-foreground)" }}
            aria-label={show ? "Hide password" : "Show password"}
          >
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
    </div>
  );
}
