import pandas as pd
import matplotlib.pyplot as plt

print("=== Locust Request Stats Summary ===")

df = pd.read_csv("requests_stats.csv")

df = df.dropna(subset=['Type', 'Name'])

numeric_cols = [
    'Request Count', 'Failure Count', 'Median Response Time',
    'Average Response Time', 'Min Response Time', 'Max Response Time',
    'Requests/s', 'Failures/s', '90%', '99%'
]
df[numeric_cols] = df[numeric_cols].apply(pd.to_numeric, errors='coerce')

total_requests = df['Request Count'].sum()
total_failures = df['Failure Count'].sum()
fail_rate = total_failures / total_requests * 100 if total_requests else 0
avg_latency = df['Average Response Time'].mean()
median_latency = df['Median Response Time'].mean()
p90 = df['90%'].mean()
p99 = df['99%'].mean()

summary = {
    'Total Requests': total_requests,
    'Failures': total_failures,
    'Fail Rate (%)': fail_rate,
    'Avg Latency (ms)': avg_latency,
    'Median (ms)': median_latency,
    'P90 (ms)': p90,
    'P99 (ms)': p99,
}

for k, v in summary.items():
    print(f"{k:20}: {v:.2f}")

plt.figure(figsize=(10, 6))
df_sorted = df.sort_values("99%", ascending=False)
plt.barh(df_sorted["Name"], df_sorted["99%"], color="skyblue")
plt.title("P99 Latency per Endpoint")
plt.xlabel("Latency (ms)")
plt.tight_layout()
plt.grid(axis="x", linestyle="--", alpha=0.7)
plt.show()

print("\n=== MongoDB Resource Usage ===")

ds = pd.read_csv("docker_stat.csv", parse_dates=['timestamp'])

mongo = ds[ds['container'].str.contains('mongo', case=False, na=False)].copy()

mongo['cpu_percent'] = mongo['cpu_percent'].str.replace('%', '').astype(float)
mongo['mem_percent'] = mongo['mem_percent'].str.replace('%', '').astype(float)

print("Max CPU %       :", mongo['cpu_percent'].max())
print("Max Memory %    :", mongo['mem_percent'].max())

plt.figure(figsize=(10, 4))
plt.plot(mongo['timestamp'], mongo['cpu_percent'], label="MongoDB CPU %", color="orangered")
plt.xlabel("Time")
plt.ylabel("CPU %")
plt.title("MongoDB CPU Usage Over Time")
plt.xticks(rotation=45)
plt.tight_layout()
plt.grid(True)
plt.legend()
plt.show()
