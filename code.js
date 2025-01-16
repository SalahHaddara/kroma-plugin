figma.showUI(__html__, { width: 300, height: 300 });

figma.ui.onmessage = async (msg) => {
  console.log("Message received:", msg.type);

  try {
    if (msg.type === "generate-design-system") {
      // Step 1: Create the design system template
      const frame = await createDesignSystem();
      if (!frame) {
        throw new Error("Failed to create design system template");
      }

      // Notify UI that template is created and ready for next step
      figma.ui.postMessage({ type: "step-1-complete" });

      // Ensure the frame is visible
      figma.viewport.scrollAndZoomIntoView([frame]);
    } else if (msg.type === "apply-design-tokens") {
      if (!msg.tokens) {
        throw new Error("No tokens provided for update");
      }

      console.log("Applying design tokens:", msg.tokens);
      await updateDesignTokens(msg.tokens);

      // Find the frame again to ensure it's updated
      const frame = figma.currentPage.findOne(
        (node) => node.type === "FRAME" && node.name === "Design System",
      );

      if (frame) {
        // Force a repaint
        frame.resize(frame.width, frame.height);
        figma.viewport.scrollAndZoomIntoView([frame]);
      }

      // Notify UI that the entire process is complete
      figma.ui.postMessage({ type: "generation-complete" });
    }
  } catch (error) {
    console.error("Operation error:", error);
    figma.ui.postMessage({
      type: "generation-error",
      message: error.message,
    });
  }
};
