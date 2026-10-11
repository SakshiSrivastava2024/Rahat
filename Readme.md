# Rahat

**Flood relief that reaches every door.** Rahat connects people stranded by flooding with volunteers who can bring them food, drinking water, medicine or baby supplies.

Built for **Environmental Hacks** (WeMakeDevs x AWS, Bharat Builds Tour), Track 02: Heat and Water.

## The problem

When Lucknow floods, relief is dispatched, but families on flooded ground floors cannot walk out to collect it, and volunteers do not know who still has nothing. Some areas get skipped while others receive the same help twice.

## What Rahat does

**For a person in need**
- Choose what you need: food, drinking water, medicine, baby supplies or other essentials.
- Share your location with one tap, by tapping the map, or by typing or speaking an address. GPS is never required.
- Say how many people there are, and flag a baby, an elderly person, someone sick, or someone who has difficulty moving.
- Get a request ID and follow the status under **My Requests**.
- Use it in Hindi or English.
- If the network drops, the request is saved on the phone and sent automatically when it returns.

**For a volunteer**
- See every request on a live map and in a list, with the most urgent first.
- Click a card and the map jumps to the pin. Click a pin and its card is highlighted.
- Filter by status and type.
- Accept a request, then see the phone number, then mark it delivered with a note.

**What keeps relief from being forgotten**
- **Urgency score:** infants, medical need, elderly people, group size, need type and waiting time decide the order.
- **No duplicate deliveries:** only one volunteer can accept a request, and only that volunteer can mark it delivered.
- **Claims expire:** if a request is accepted but not delivered within 3 hours, it reopens for other volunteers.
- **Privacy:** phone numbers are never returned in the public list. Only the volunteer who accepts a request receives the number.

## Architecture

```
Browser (HTML, CSS, JavaScript, Leaflet, service worker)
        |  HTTPS / JSON
        v
Amazon API Gateway (HTTP API, CORS)
        |
        v
AWS Lambda (Node.js 20)
        |
        v
Amazon DynamoDB (requests table)
```

The offline queue lives in the browser (`localStorage`) and retries sending when the network returns.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Plain HTML, CSS and JavaScript, Leaflet with OpenStreetMap, service worker, Web Speech API for voice input |
| Backend | AWS SAM, Amazon API Gateway (HTTP API), AWS Lambda (Node.js 20, AWS SDK v3), Amazon DynamoDB |
| Local development | Docker Desktop with DynamoDB Local, AWS SAM CLI |

## How AWS is used

**AWS open source:** the AWS SAM CLI builds and runs the backend (`sam build`, `sam local start-api`), and the AWS SDK for JavaScript v3 is used inside the Lambda function.

**AWS services:** API Gateway (routes and CORS), Lambda (all request logic), and DynamoDB (storage, with conditional updates for claiming and delivering). All three are defined in `backend/template.yaml`.

**Current status:** the full backend has been run and tested locally through SAM, with DynamoDB Local in Docker standing in for DynamoDB. It has not been deployed to AWS yet. The same template deploys with one command (see below).

## Project structure

```
backend/
  template.yaml     SAM template: API, Lambda function, DynamoDB table
  src/app.mjs       Lambda handler
frontend/
  index.html        The whole app
  sw.js             Service worker (offline loading)
```

## Run it locally

You need Docker Desktop and the AWS SAM CLI. No AWS account is required.

**1. Start the local database (once)**

```bash
docker run -d --name dynamo -u root -p 8000:8000 -v rahat-data:/home/dynamodblocal/data amazon/dynamodb-local -jar DynamoDBLocal.jar -sharedDb -dbPath /home/dynamodblocal/data
```

Next time, run `docker start dynamo`. Your data is kept in the `rahat-data` volume.

**2. Build and start the API**

```bash
cd backend
sam build
sam local start-api --parameter-overrides DynamoEndpoint=http://host.docker.internal:8000
```

The API runs at `http://127.0.0.1:3000`. The table is created automatically on the first request. On Linux, replace `host.docker.internal` with your machine's IP address.

**3. Serve the frontend** (in a second terminal)

```bash
cd frontend
python -m http.server 5500
```

Open `http://localhost:5500`. Use `localhost`, because location access and the service worker need it.

To point the frontend at a different API, add `?api=https://your-api-url` to the address.

## API

| Method | Path | Description |
|---|---|---|
| POST | `/requests` | Create a request. Fields: `need` (food, water, medicine, baby supplies, other), `description`, `people`, `infant`, `elderly`, `medical`, `lat`, `lng`, `phone` |
| GET | `/requests` | List requests, most urgent first, delivered last. Phone numbers are never included |
| PATCH | `/requests/{id}` | `{"action":"claim","volunteer":"Name"}` or `{"action":"deliver","volunteer":"Name","note":"..."}` |

Statuses are `requested`, `claimed` and `delivered`. A claim older than 180 minutes shows as `requested` again.

## Deploy to AWS

With an AWS account configured:

```bash
cd backend
sam build
sam deploy --guided
```

The `ApiUrl` output is the base URL for the frontend (`?api=<ApiUrl>`). The frontend is static files, so it can be hosted on AWS Amplify Hosting or any static host.

## Known limitations

- A request has one category. Extra needs go in the note.
- The API returns exact coordinates in the public list. Rounding them until a request is accepted would be a good next step.
- The listing uses a DynamoDB scan, which is fine for a hackathon but not for large volumes.
- There is no volunteer login yet. A volunteer's name is used to claim and deliver, so a stronger identity check is needed for real use.
- Voice input needs a network and Chrome or Edge.
- Rahat does not replace emergency services. If life is in danger, call 112.

## What is next

- SMS requests for areas with no data connection.
- Volunteer verification and sign-in.
- Rounding or hiding exact locations until a request is accepted.
- Notifications to volunteers, for example with Amazon SNS.
- Deployment to AWS with Amplify Hosting for the frontend.

## License

MIT. See `LICENSE`.

## Author

Built by Sakshi for Environmental Hacks.