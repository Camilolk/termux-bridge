const ALLOWED_OPERATIONS = new Set(["pwd", "python-version", "list-workspace"]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function authorized(request, env) {
  const expected = env.BRIDGE_TOKEN;
  const supplied = request.headers.get("authorization") || "";
  return Boolean(
    expected &&
    supplied.startsWith("Bearer ") &&
    supplied.slice(7).length === expected.length &&
    timingSafeEqual(supplied.slice(7), expected)
  );
}

function timingSafeEqual(a, b) {
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        status: "online",
        service: "Termux Bridge",
        version: "0.3.0"
      });
    }

    if (!authorized(request, env)) {
      return json({ error: "unauthorized" }, 401);
    }

    if (!env.TASK_QUEUE) {
      return json({ error: "queue_not_configured" }, 503);
    }

    const id = env.TASK_QUEUE.idFromName("main");
    const stub = env.TASK_QUEUE.get(id);

    if (request.method === "POST" && url.pathname === "/v1/tasks") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid_json" }, 400);
      }

      if (!body || !ALLOWED_OPERATIONS.has(body.operation)) {
        return json({ error: "operation_not_allowed" }, 400);
      }

      return stub.fetch("https://queue/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: body.operation })
      });
    }

    if (request.method === "GET" && url.pathname === "/v1/next") {
      return stub.fetch("https://queue/next", { method: "GET" });
    }

    const taskMatch = url.pathname.match(/^\/v1\/tasks\/([a-f0-9-]+)$/i);
    if (request.method === "GET" && taskMatch) {
      return stub.fetch("https://queue/tasks/" + taskMatch[1], {
        method: "GET"
      });
    }

    const resultMatch = url.pathname.match(/^\/v1\/tasks\/([a-f0-9-]+)\/result$/i);
    if (request.method === "POST" && resultMatch) {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid_json" }, 400);
      }

      if (
        !body ||
        typeof body.ok !== "boolean" ||
        typeof body.output !== "string"
      ) {
        return json({ error: "invalid_result" }, 400);
      }

      return stub.fetch("https://queue/tasks/" + resultMatch[1] + "/result", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ok: body.ok,
          output: body.output.slice(0, 4000)
        })
      });
    }

    return json({ error: "not_found" }, 404);
  }
};

export class TaskQueue {
  constructor(state) {
    this.state = state;
    this.storage = state.storage;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/tasks") {
      const body = await request.json();
      const task = {
        id: crypto.randomUUID(),
        operation: body.operation,
        status: "pending",
        created_at: new Date().toISOString()
      };

      await this.storage.put("task:" + task.id, task);
      const ids = (await this.storage.get("pending")) || [];
      ids.push(task.id);
      await this.storage.put("pending", ids);

      return json({ task_id: task.id, status: task.status }, 201);
    }

    if (request.method === "GET" && url.pathname === "/next") {
      const task = await this.storage.transaction(async txn => {
        const ids = (await txn.get("pending")) || [];

        while (ids.length) {
          const id = ids.shift();
          const item = await txn.get("task:" + id);

          if (item && item.status === "pending") {
            item.status = "running";
            item.started_at = new Date().toISOString();
            await txn.put("task:" + id, item);
            await txn.put("pending", ids);
            return item;
          }
        }

        await txn.put("pending", ids);
        return null;
      });

      return json({ task });
    }

    const taskMatch = url.pathname.match(/^\/tasks\/([a-f0-9-]+)$/i);
    if (request.method === "GET" && taskMatch) {
      const task = await this.storage.get("task:" + taskMatch[1]);

      if (!task) {
        return json({ error: "task_not_found" }, 404);
      }

      return json({ task });
    }

    const resultMatch = url.pathname.match(/^\/tasks\/([a-f0-9-]+)\/result$/i);
    if (request.method === "POST" && resultMatch) {
      const task = await this.storage.get("task:" + resultMatch[1]);

      if (!task) {
        return json({ error: "task_not_found" }, 404);
      }

      if (task.status !== "running") {
        return json({ error: "task_not_running" }, 409);
      }

      const body = await request.json();
      task.status = body.ok ? "completed" : "failed";
      task.output = body.output;
      task.completed_at = new Date().toISOString();

      await this.storage.put("task:" + task.id, task);

      return json({ task_id: task.id, status: task.status });
    }

    return json({ error: "not_found" }, 404);
  }
}
