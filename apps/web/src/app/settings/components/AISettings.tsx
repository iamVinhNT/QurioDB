/**
 * @file AISettings.tsx
 * @description Root AI settings component that orchestrates sub-components for provider and model management.
 */

import { useState, useEffect, useCallback } from "react";
import { z } from "zod";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { aiApi } from "@/lib/api-client";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSettingsActions } from "../context/SettingsActionsContext";

// Sub-components
import { ProviderConfig } from "./ai-settings/ProviderConfig";
import { ModelLibrary } from "./ai-settings/ModelLibrary";
import { AddModelDialog } from "./ai-settings/AddModelDialog";
import { DeleteModelDialog } from "./ai-settings/DeleteModelDialog";
import { RagIndexingCard } from "./ai-settings/RagIndexingCard";
import { RouterTermsCard } from "./ai-settings/RouterTermsCard";
import { TaskRoutingCard } from "./ai-settings/TaskRoutingCard";
import { VectorStoreMapScreen } from "./ai-settings/VectorStoreMapScreen";
import { AIModel, AITaskAssignment, AITaskCatalogItem, NewAIModel } from "./ai-settings/types";
import {
  AISettingsSectionKey,
  AISettingsSectionRail,
} from "./ai-settings/AISettingsSectionRail";

const aiConfigResponseSchema = z.object({
  apiKey: z.string().nullable(),
  provider: z.string(),
  baseUrl: z.string().optional(),
});

/**
 * Main AI Settings component.
 * Adheres to Clean Code standards by modularizing large sections into sub-components.
 */
export function AISettings() {
  const queryClient = useQueryClient();
  const { registerActions } = useSettingsActions();

  // State for Provider Config
  const [apiKey, setApiKey] = useState("");
  const [provider, setProvider] = useState<string>();
  const [baseUrl, setBaseUrl] = useState("");

  // State for Add Model Form
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [modelToDelete, setModelToDelete] = useState<{ id: string, name: string } | null>(null);
  const [newModel, setNewModel] = useState<NewAIModel>({ name: "", modelId: "", provider: "Google", description: "" });
  const [activeSection, setActiveSection] = useState<AISettingsSectionKey>("gateway");

  // 1. Fetch AI Config
  const configQuery = useQuery({
    queryKey: ["ai-config", provider],
    queryFn: () => aiApi.getAIConfig(false, provider),
  });

  // 2. Fetch Available Models
  const modelsQuery = useQuery({
    queryKey: ["ai-models"],
    queryFn: () => aiApi.getModels(),
  });

  const statusQuery = useQuery({
    queryKey: ["ai-status"],
    queryFn: () => aiApi.getAIStatus(),
  });

  const ragSourcesQuery = useQuery({
    queryKey: ["rag-sources"],
    queryFn: () => aiApi.getRagSources(),
  });

  const taskCatalogQuery = useQuery({
    queryKey: ["ai-task-catalog"],
    queryFn: () => aiApi.getTaskCatalog(),
  });

  const taskAssignmentsQuery = useQuery({
    queryKey: ["ai-task-assignments"],
    queryFn: () => aiApi.getTaskAssignments(),
  });

  // Synchronize local state with fetched config
  useEffect(() => {
    if (configQuery.data) {
      setApiKey(configQuery.data.apiKey || "");
      setProvider(configQuery.data.provider || "Google");
      setBaseUrl(configQuery.data.baseUrl || "");
    }
  }, [configQuery.data]);

  // Mutation: Save Provider Config
  const saveConfigMutation = useMutation({
    mutationFn: (data: { apiKey: string; provider: string; baseUrl?: string }) => aiApi.saveAIConfig(data),
    onSuccess: () => {
      toast.success("AI Configuration saved to ecosystem.");
      queryClient.invalidateQueries({ queryKey: ["ai-config", provider] });
      queryClient.invalidateQueries({ queryKey: ["ai-status"] });
    },
    onError: (err: any) => toast.error(`Sync failed: ${err.message}`),
  });

  const handleSaveConfig = useCallback(async () => {
    if (!apiKey) return; // Don't save if empty (or show error if triggered manually)
    if (provider?.toLowerCase() === "custom" && !baseUrl.trim()) {
      toast.error("Custom Provider requires a Base URL.");
      return;
    }
    await saveConfigMutation.mutateAsync({ apiKey, provider: provider || "Google", baseUrl });
  }, [apiKey, provider, baseUrl, saveConfigMutation]);

  const handleReset = useCallback(() => {
    // Reset local state to what's currently in the backend
    if (configQuery.data) {
      setApiKey(configQuery.data.apiKey || "");
      setProvider(configQuery.data.provider || "Google");
      setBaseUrl(configQuery.data.baseUrl || "");
    }
    toast.info("AI settings restored to last sync");
  }, [configQuery.data]);

  // Register actions for global buttons
  useEffect(() => {
    registerActions("ai", {
      onSave: handleSaveConfig,
      onReset: handleReset
    });
  }, [registerActions, handleSaveConfig, handleReset]);

  // Mutation: Add New Model
  const addModelMutation = useMutation({
    mutationFn: (data: any) => aiApi.addModel(data),
    onSuccess: () => {
      toast.success("Neural node registered successfully.");
      setIsAddDialogOpen(false);
      setNewModel({ name: "", modelId: "", provider: "Google", description: "" });
      queryClient.invalidateQueries({ queryKey: ["ai-models"] });
    },
    onError: (err: any) => toast.error(`Registration failed: ${err.message}`),
  });

  // Mutation: Delete Model
  const deleteModelMutation = useMutation({
    mutationFn: (id: string) => aiApi.deleteModel(id),
    onSuccess: () => {
      toast.success("Neural node de-registered.");
      setIsDeleteDialogOpen(false);
      setModelToDelete(null);
      queryClient.invalidateQueries({ queryKey: ["ai-models"] });
    },
    onError: (err: any) => toast.error(`De-registration failed: ${err.message}`),
  });

  const saveTaskAssignmentsMutation = useMutation({
    mutationFn: (assignments: AITaskAssignment[]) => aiApi.saveTaskAssignments(assignments),
    onSuccess: () => {
      toast.success("AI task routing saved.");
      queryClient.invalidateQueries({ queryKey: ["ai-task-assignments"] });
    },
    onError: (err: any) => toast.error(`Routing save failed: ${err.message}`),
  });

  // Mutation: Reveal API Key
  const revealKeyMutation = useMutation({
    mutationFn: async () => aiConfigResponseSchema.parse(await aiApi.getAIConfig(true, provider)),
    onSuccess: (data) => {
      if (data.apiKey) {
        setApiKey(data.apiKey);
        toast.success("Identity verified. API Key revealed.");
      }
    },
    onError: (err: any) => toast.error(`Verification failed: ${err.message}`),
  });

  const handleAddModel = () => {
    if (!newModel.name || !newModel.modelId) {
      toast.error("Alias and Engine ID are required.");
      return;
    }
    addModelMutation.mutate(newModel);
  };

  const handleDeleteModel = (id: string) => {
    const model = (modelsQuery.data as AIModel[])?.find(m => m.id === id);
    if (model) {
      setModelToDelete({ id: model.id, name: model.name });
      setIsDeleteDialogOpen(true);
    }
  };

  const handleConfirmDelete = () => {
    if (modelToDelete) {
      deleteModelMutation.mutate(modelToDelete.id);
    }
  };

  const models = (modelsQuery.data as AIModel[]) || [];
  const taskCatalog = (taskCatalogQuery.data as AITaskCatalogItem[]) || [];
  const taskAssignments = (taskAssignmentsQuery.data as AITaskAssignment[]) || [];
  const providerHealth = statusQuery.data?.providers?.[provider?.toLowerCase() || "google"];
  const hasProviderKey = providerHealth?.hasApiKey ?? Boolean(apiKey && apiKey !== "********");
  const activeModels = models.filter((model) => model.isActive).length;

  const sectionMetrics: Partial<Record<AISettingsSectionKey, string>> = {
    gateway: hasProviderKey ? "key" : "open",
    models: String(models.length),
    routing: String(taskCatalog.length),
    terms: "db",
    rag: statusQuery.data?.rag?.enabled ? "on" : "local",
    "vector-store": Array.isArray(ragSourcesQuery.data) ? String(ragSourcesQuery.data.length) : undefined,
  };

  const renderActiveSection = () => {
    switch (activeSection) {
      case "gateway":
        return (
          <ProviderConfig
            apiKey={apiKey}
            setApiKey={setApiKey}
            provider={provider || "Google"}
            setProvider={setProvider}
            baseUrl={baseUrl}
            setBaseUrl={setBaseUrl}
            onSave={handleSaveConfig}
            onReveal={() => revealKeyMutation.mutate()}
            isSaving={saveConfigMutation.isPending}
            isRevealing={revealKeyMutation.isPending}
          />
        );
      case "models":
        return (
          <ModelLibrary
            models={models}
            isLoading={modelsQuery.isLoading}
            onDelete={handleDeleteModel}
          >
            <AddModelDialog
              isOpen={isAddDialogOpen}
              setIsOpen={setIsAddDialogOpen}
              newModel={newModel}
              setNewModel={setNewModel}
              onAdd={handleAddModel}
              isAdding={addModelMutation.isPending}
            />
          </ModelLibrary>
        );
      case "routing":
        return (
          <TaskRoutingCard
            catalog={taskCatalog}
            assignments={taskAssignments}
            models={models}
            runtimeStatus={statusQuery.data}
            isLoading={taskCatalogQuery.isLoading || taskAssignmentsQuery.isLoading || modelsQuery.isLoading}
            isSaving={saveTaskAssignmentsMutation.isPending}
            onSave={(assignments) => saveTaskAssignmentsMutation.mutate(assignments)}
          />
        );
      case "terms":
        return <RouterTermsCard />;
      case "rag":
        return <RagIndexingCard />;
      case "vector-store":
        return <VectorStoreMapScreen onAddSources={() => setActiveSection("rag")} />;
      default:
        return null;
    }
  };

  return (
    <TooltipProvider delay={200}>
      <div className="h-[calc(100vh-175px)] min-h-136 overflow-hidden pr-2 pt-1">
        <div className="flex h-full flex-col gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
            <AISettingsSectionRail
              activeSection={activeSection}
              onSectionChange={setActiveSection}
              metrics={sectionMetrics}
            />

            <div
              className="min-h-0 overflow-y-auto pr-3 custom-scrollbar"
              role="tabpanel"
              id={`ai-settings-panel-${activeSection}`}
              aria-labelledby={`ai-settings-tab-${activeSection}`}
            >
              <div className="pb-8">
                {renderActiveSection()}
              </div>
            </div>
          </div>

          <DeleteModelDialog
            isOpen={isDeleteDialogOpen}
            setIsOpen={setIsDeleteDialogOpen}
            onConfirm={handleConfirmDelete}
            isDeleting={deleteModelMutation.isPending}
            modelName={modelToDelete?.name || ""}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}
