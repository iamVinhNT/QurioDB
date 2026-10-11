/**
 * @file AddModelDialog.tsx
 * @description Dialog component for registering new AI models.
 */

import { PlusCircle, Sparkles, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NewAIModel } from "./types";

interface AddModelDialogProps {
  isOpen: boolean;
  setIsOpen: (val: boolean) => void;
  newModel: NewAIModel;
  setNewModel: (val: NewAIModel) => void;
  onAdd: () => void;
  isAdding: boolean;
}

export function AddModelDialog({
  isOpen,
  setIsOpen,
  newModel,
  setNewModel,
  onAdd,
  isAdding
}: AddModelDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="rounded-2xl gap-2 font-bold tracking-tight bg-background/50 border-cyan-500/20 hover:bg-cyan-500/5 transition-all">
            <PlusCircle className="h-3.5 w-3.5 text-cyan-500" /> New Model
          </Button>
        }
      />
      <DialogContent className="border-border/50 sm:max-w-[800px] p-0 overflow-hidden rounded-2xl shadow-2xl">
        <div className="p-10 space-y-8">
          <div className="space-y-2">
            <DialogTitle className="text-3xl font-bold">Register New Model</DialogTitle>
            <DialogDescription className="text-base text-muted-foreground">
              Add a custom AI model to the system by providing its engine details.
            </DialogDescription>
          </div>

          <div className="space-y-6 pt-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground ml-1">Alias Name</label>
              <Input
                placeholder="e.g. Gemini 1.5 Pro"
                className="rounded-xl bg-muted/20 border-border/40 h-12 text-base px-4"
                value={newModel.name}
                onChange={e => setNewModel({ ...newModel, name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground ml-1">Engine ID</label>
              <Input
                placeholder="gemini-1.5-pro"
                className="rounded-xl bg-muted/20 border-border/40 h-12 font-mono text-base px-4"
                value={newModel.modelId}
                onChange={e => setNewModel({ ...newModel, modelId: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground ml-1">Core Capability</label>
              <Input
                placeholder="Describe model specialized reasoning..."
                className="rounded-xl bg-muted/20 border-border/40 h-12 text-base px-4"
                value={newModel.description}
                onChange={e => setNewModel({ ...newModel, description: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground ml-1">Provider</label>
              <Select value={newModel.provider} onValueChange={v => setNewModel({ ...newModel, provider: v || "" })}>
                <SelectTrigger className="w-full rounded-xl bg-muted/20 border-border/40 h-12 text-base px-4 transition-all hover:bg-muted/30">
                  <SelectValue placeholder="Select Provider" />
                </SelectTrigger>
                <SelectContent 
                  side="bottom" 
                  alignItemWithTrigger={false} 
                  className="rounded-xl border-border/50"
                >
                  <SelectItem value="OpenAI" className="text-base py-3 px-4">OpenAI</SelectItem>
                  <SelectItem value="Google" className="text-base py-3 px-4">Google Gemini</SelectItem>
                  <SelectItem value="Anthropic" className="text-base py-3 px-4">Anthropic Claude</SelectItem>
                  <SelectItem value="Qwen" className="text-base py-3 px-4">Qwen</SelectItem>
                  <SelectItem value="DeepSeek" className="text-base py-3 px-4">DeepSeek</SelectItem>
                  <SelectItem value="Custom" className="text-base py-3 px-4">Custom Provider (OpenAI-compatible)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end p-6 bg-muted/30 border-t border-border/40 gap-3">
          <Button variant="ghost" className="rounded-xl font-semibold h-11 px-6 text-base" onClick={() => setIsOpen(false)}>Abort</Button>
          <Button className="rounded-xl px-10 h-11 bg-primary hover:bg-primary/90 font-bold text-base shadow-xl" onClick={onAdd} disabled={isAdding}>
            {isAdding ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlusCircle className="h-4 w-4 mr-2" />}
            Register Model
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
