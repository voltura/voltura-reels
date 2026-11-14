const urlPattern = /(?<![\p{L}\p{N}@._/:-])(?:https?:\/\/[^\s<>"“”‘’…]+|(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+[\p{L}]{2,}(?::\d+)?(?:[/?#][^\s<>"“”‘’…]*)?)/giu;
const brackets = { ')': '(', ']': '[' };

export function webLink(value) {
  try {
    const url = new URL(value);
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return url.href;
  } catch {
    return undefined;
  }
}

function trimLink(label) {
  while (label) {
    const last = label.at(-1);
    const opening = brackets[last];
    if (/[.,!?;:]/.test(last) || (opening && label.split(last).length > label.split(opening).length)) {
      label = label.slice(0, -1);
    } else {
      break;
    }
  }
  return label;
}

export function renderCaption(container, { text, links }) {
  const fragment = document.createDocumentFragment();
  function appendLink(label, href) {
    const link = document.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = label;
    fragment.append(link);
  }

  function appendText(value) {
    let position = 0;
    for (const match of value.matchAll(urlPattern)) {
      const label = trimLink(match[0]);
      const href = webLink(/^https?:\/\//i.test(label) ? label : `https://${label}`);
      if (!href) continue;
      fragment.append(value.slice(position, match.index));
      appendLink(label, href);
      position = match.index + label.length;
    }
    fragment.append(value.slice(position));
  }

  let position = 0;
  for (const { start, end, href } of links) {
    appendText(text.slice(position, start));
    appendLink(text.slice(start, end), href);
    position = end;
  }
  appendText(text.slice(position));
  container.replaceChildren(fragment);
}
