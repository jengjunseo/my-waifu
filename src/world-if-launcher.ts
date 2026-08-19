const newChatButton = document.querySelector<HTMLButtonElement>("#new-chat");

if (newChatButton) {
  let bypass = false;

  const closeChooser = () => {
    document.querySelector("#world-if-chooser")?.remove();
  };

  const openChooser = () => {
    closeChooser();
    const backdrop = document.createElement("div");
    backdrop.id = "world-if-chooser";
    backdrop.className = "world-if-chooser";

    const card = document.createElement("section");
    card.className = "world-if-chooser-card";
    const eyebrow = document.createElement("div");
    eyebrow.className = "world-if-chooser-eyebrow";
    eyebrow.textContent = "새 대화";
    const title = document.createElement("h2");
    title.textContent = "어떤 방식으로 시작할까요?";
    const description = document.createElement("p");
    description.textContent = "한 캐릭터와 1:1로 대화하거나, 작품 세계 전체가 움직이는 World IF를 시작할 수 있습니다.";

    const character = document.createElement("button");
    character.type = "button";
    character.className = "world-if-choice";
    character.innerHTML = "<strong>Character Chat</strong><span>현재 캐릭터로 새 1:1 대화</span>";
    character.addEventListener("click", () => {
      closeChooser();
      bypass = true;
      newChatButton.click();
      bypass = false;
    });

    const world = document.createElement("button");
    world.type = "button";
    world.className = "world-if-choice featured";
    world.innerHTML = "<strong>World IF</strong><span>어마금 세계에 새로운 변수를 넣고 시작</span>";
    world.addEventListener("click", () => {
      location.href = "/world.html";
    });

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "world-if-choice-cancel";
    cancel.textContent = "취소";
    cancel.addEventListener("click", closeChooser);

    card.append(eyebrow, title, description, character, world, cancel);
    backdrop.append(card);
    backdrop.addEventListener("mousedown", (event) => {
      if (event.target === backdrop) closeChooser();
    });
    document.body.append(backdrop);
  };

  newChatButton.addEventListener("click", (event) => {
    if (bypass) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openChooser();
  }, true);
}
