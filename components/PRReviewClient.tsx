"use client";
import { useEffect, useState } from "react";
import LocalDate from "./LocalDate";

interface PRReviewClientProps {
  selectedPR: any;
  onTextChange?: (text: string) => void;
  onGenerate: () => void;
  generating: boolean;
}

export default function PRReviewClient({ selectedPR, onTextChange, onGenerate, generating }: PRReviewClientProps) {
  const [primaryText, setPrimaryText] = useState("");

  useEffect(() => {
    if (selectedPR && selectedPR.body) {
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = selectedPR.body;
      setPrimaryText(tempDiv.textContent || tempDiv.innerText || "");
      onTextChange && onTextChange(tempDiv.textContent || tempDiv.innerText || "");
    } else {
      setPrimaryText("");
      onTextChange && onTextChange("");
    }
    // eslint-disable-next-line
  }, [selectedPR]);

  return selectedPR ? (
    <div style={{ marginBottom: 20 }}>
      <h2>Selected PR</h2>
      <div style={{ background: "#f9fafb", padding: 10, borderRadius: 4, marginBottom: 10 }}>
        <strong>{selectedPR.headline}</strong>
        <br />
        <LocalDate dateString={selectedPR.created} />
        <textarea
          value={primaryText}
          onChange={e => {
            setPrimaryText(e.target.value);
            onTextChange && onTextChange(e.target.value);
          }}
          rows={16}
          style={{ width: "100%", fontFamily: "monospace", fontSize: 14, marginTop: 10 }}
        />
        {selectedPR.url && (
          <div style={{ marginTop: 8 }}>
            <a href={selectedPR.url} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", textDecoration: "underline", fontSize: 13 }}>
              View Full PR
            </a>
          </div>
        )}
      </div>
      <button
        onClick={onGenerate}
        disabled={generating}
        style={{ padding: "8px 16px", background: "#2563eb", color: "white", border: "none", borderRadius: 4 }}
      >
        {generating ? "Generating Story..." : "Generate Story"}
      </button>
    </div>
  ) : null;
} 