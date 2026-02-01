export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null && text !== "") node.textContent = text;
  return node;
}

export function append(parent, ...children) {
  children.forEach((child) => {
    if (child) parent.appendChild(child);
  });
}
