console.log("yo");

// Wait for CSS to be applied, then shake tree
requestAnimationFrame(() => {
  window.dispatchEvent(new Event('resize'));
  console.log('Layout recalculated');
});
