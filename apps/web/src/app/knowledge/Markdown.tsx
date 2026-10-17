/** @file Markdown.tsx @description Read-only Markdown without HTML, remote media or executable links. */
import ReactMarkdown from "react-markdown";
export function Markdown({ body }: { body: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none break-words [&_pre]:overflow-x-auto">
      <ReactMarkdown
        skipHtml
        components={{
          img: () => null,
          a: ({ href, children }) =>
            href && /^https?:\/\//i.test(href) ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
