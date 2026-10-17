/** @file page.tsx @description Lazy knowledge route entry point. */
import { useParams } from "react-router-dom";
import { Library } from "./Library";
import { Workspace } from "./Workspace";
import { Card, CardContent } from "@/components/ui/card";
export default function KnowledgePage() {
  const { knowledgeBaseId, documentId } = useParams();
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1600px]">
        <Card className="group/card relative border-none bg-card/50 shadow-premium backdrop-blur-sm">
          <div className="absolute left-0 top-0 h-full w-1 bg-gradient-to-b from-fuchsia-500 to-violet-600 transition-all group-hover/card:w-1.5" />
          <CardContent className="px-4">
            {knowledgeBaseId ? (
              <Workspace
                key={knowledgeBaseId}
                baseId={knowledgeBaseId}
                documentId={documentId}
              />
            ) : (
              <Library />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
