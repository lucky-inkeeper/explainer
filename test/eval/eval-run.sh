#!/bin/zsh
cd "$(dirname "$0")"
mkdir -p out out/png
node cdp.mjs eval "localStorage.removeItem('evalSeen'); 'reset'" >/dev/null
node cdp.mjs eval "(()=>{ if(!document.querySelector('.chat-log')) return 'closed'; return 'open'; })()" | grep -q open || node cdp.mjs click 1457 34
typeset -a P
P=(
  "architecture|Draw the architecture of a URL shortener service: CDN, API, Postgres, Redis cache, and an analytics pipeline. Group by tier."
  "flowchart|Show the decision logic for a password reset request: known email, rate limit, token valid, token expired."
  "sequence|Show the message flow when a user checks out with a saved card: browser, checkout API, payment provider, orders database. Include the failed payment branch."
  "state|Draw the state machine of a subscription: trial, active, past due, canceled, expired."
  "er|Draw the data model of a blog: users, posts, comments, tags, with cardinality."
  "db-schema|Draw the physical Postgres schema for orders and order_items: column types, primary keys, the foreign key with its ON DELETE behavior, and the index on orders.customer_id."
  "timeline|Draw the timeline of an incident: alert 02:10, on-call paged 02:14, rollback started 02:40, resolved 03:05, postmortem two days later."
  "swimlane|Map the hiring process across recruiter, hiring manager, and candidate, from job posting to signed offer."
  "quadrant|Place these features on an impact versus effort quadrant: dark mode, SSO, export to CSV, mobile app, in-app search, billing portal. Mark what to do first."
  "tree|Draw the folder tree of a typical Electron app: src/main, src/preload, src/renderer with components and hooks, shared, docs."
  "org-chart|Draw the org chart of a support team: head of support, a tier 1 pod with three agents, a tier 2 pod with two engineers, and escalation to the engineering on-call. Show how to reach each one."
  "layers|Draw the layer stack of a web request: browser, CDN, load balancer, app server, ORM, database. Mark the layer where most latency is spent."
  "kanban|Draw a kanban board for a platform team: backlog with 3 items, in progress with limit 3 and 4 items, review with limit 2 and 1 item, done with 2 items. One item in progress is blocked."
  "journey|Draw the user journey of a first-week trial user: sign up, import data, first report, hit the plan limit, upgrade. Include how it feels at each stage."
  "deployment|Draw the deployment of a web app on AWS: CloudFront, two ECS app replicas running api v2.4.1, RDS primary with a standby, S3 for uploads. Show ports."
  "dependency|Draw the dependency graph of a monorepo: web, api, worker, shared-utils, db-client, logger. web and api depend on shared-utils and db-client; worker depends on db-client and logger; shared-utils depends on logger; logger depends on shared-utils."
)
i=0
: > out/summary.md
for entry in "${P[@]}"; do
  i=$((i+1)); slug="${entry%%|*}"; prompt="${entry#*|}"; n=$(printf "%02d" $i)
  node cdp.mjs eval "document.querySelector('.composer-foot button.new').click(); 'new'" >/dev/null; sleep 6
  node turn.mjs "$prompt" 360 > "out/$n-$slug.log" 2>&1
  sleep 2
  frame=$(node cdp.mjs evalfile shot-new.js 2>&1); sleep 1
  node cdp.mjs shot "out/$n-$slug.png" >/dev/null 2>&1
  last=$(grep "^msg text" "out/$n-$slug.log" | tail -1 | cut -c1-200)
  warn=$(grep -c "warnings" "out/$n-$slug.log")
  secs=$(grep -o "^--- [0-9]*s" "out/$n-$slug.log" | head -1)
  echo "- $n $slug: $secs frame=$frame warnings-mentions=$warn | $last" >> out/summary.md
  echo "done $n $slug"
done
echo ALL-DONE
