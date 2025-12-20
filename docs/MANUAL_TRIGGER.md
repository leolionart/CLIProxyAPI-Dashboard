# Manual Data Collection Trigger Guide

The Collector system is designed to collect data automatically according to a predefined interval (default is 5 minutes). However, there are cases where you want to update the dashboard data immediately. The system provides a mechanism to do this via an HTTP endpoint.

## 1. Operating Mechanism

The Collector process runs a small lightweight Flask web server alongside the main collection loop. This server listens for incoming requests on a specified port and provides an endpoint to trigger collection.

- **Default Port:** `5001`
- **Endpoint:** `/trigger`
- **HTTP Method:** `POST`

When a `POST` request is sent to `http://<collector_host>:5001/trigger`, the Collector process will immediately execute the entire data collection workflow, including:
1.  Calling the CLIProxy Management API to retrieve the latest usage data.
2.  Processing data, calculating estimated costs.
3.  Storing processed data into the Supabase database.
4.  Synchronizing and recalculating rate limit statuses.

This process is identical to an automated collection cycle but is executed at the exact time of the request instead of waiting.

## 2. How to Trigger

You can use any tool capable of sending HTTP requests, such as `curl`, Postman, or programming within your application.

### Using `curl` (Command Line)

This is the simplest way for testing or manual triggering. Open a terminal and run the following command:

```bash
curl -X POST http://localhost:5001/trigger
```

**Notes:**
- Replace `localhost` with the IP address or domain name of the server running the Collector process if you are not running it from the same machine.
- Port `5001` is the default. If you have changed the `COLLECTOR_TRIGGER_PORT` environment variable, use the corresponding port.

### Response

- **Success:** If the collection process is successful, you will receive a JSON response similar to the following with a `200 OK` status code:
  ```json
  {
    "status": "success",
    "message": "Data collected",
    "timestamp": "2025-12-16T10:30:00.123456"
  }
  ```

- **Failure:** If an error occurs during collection, you will receive a response with a `500 Internal Server Error` status code and an error message:
  ```json
  {"status":"error","message":"[Error description, e.g.: Failed to connect to Supabase]"}
  ```

## 3. Practical Application: "Refresh" Button

On the dashboard interface, the "Refresh" button is programmed to send this `POST /trigger` request to the backend. This allows users to get the latest data with just one click, providing a better user experience and real-time monitoring capabilities.
