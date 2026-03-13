// post.js

async function sendPost() {
  const url = "https://example.com/api/data";

  const data = {
    title: "안녕하세요",
    content: "테스트 글입니다."
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      throw new Error(`HTTP 오류: ${response.status}`);
    }

    const result = await response.json();
    console.log("성공:", result);
  } catch (error) {
    console.error("실패:", error);
  }
}

sendPost();