# 🚗 RoadGuard

### Smart Vehicle Safety, Accident Detection & Risk Prevention System

RoadGuard is a smart, plug-and-play vehicle safety system designed to **prevent accidents, detect crashes, and reduce emergency response time**.

Unlike conventional accident detection systems that only respond after a crash, RoadGuard combines **real-time vehicle monitoring with historical accident-prone zone data** to provide proactive warnings to drivers.

---

## 🎯 Our Goal

To build a universal vehicle safety device that:

* ⚠️ Warns drivers before entering known accident-prone zones
* 🚨 Automatically detects accidents using motion sensors
* 📍 Sends the accident location to emergency contacts
* 📱 Works without smartphone dependency for emergency SMS alerts
* 🗺️ Provides real-time monitoring through a web dashboard
* 🤖 Generates AI-powered safety reports from journey data

---

## 💡 How It Works

```text
Sensors
   ↓
ESP32
   ↓
┌───────────────────────┐
│ Crash Detection       │
│ GPS Location          │
│ Danger Zone Detection │
└───────────────────────┘
   ↓
   ├── Danger Zone → Driver Warning
   │
   ├── Crash → GSM → Emergency SMS
   │
   └── WiFi → Backend → Web Dashboard
                         ↓
                    AI Safety Report
```

---

## 🌟 Key Features

### 1. Proactive Danger-Zone Warning

Uses GPS and historical accident/black-spot data to warn drivers when approaching high-risk locations.

### 2. Automatic Crash Detection

MPU6050 accelerometer and gyroscope data are analyzed to identify sudden impact patterns.

### 3. Automatic SOS

In the event of a detected crash, the GSM module sends an emergency SMS containing the vehicle's location.

### 4. Real-Time Dashboard

The web dashboard displays:

* Live vehicle location
* Vehicle status
* Danger zones
* Safety alerts
* Sensor connectivity
* Journey analytics
* Accident history

### 5. AI-Generated Safety Report

An LLM converts raw journey and safety data into a simple, human-readable daily report.

---

## 🛠️ Technology Stack

### Hardware

* ESP32
* MPU6050
* NEO-6M GPS
* SIM800L GSM
* Buzzer / Vibration Motor
* OBD-II connector for compatible cars

### Software

* React
* JavaScript
* HTML/CSS
* Node.js / Flask
* Leaflet.js
* Arduino / ESP32 C++
* LLM API
* Wokwi

---

## 🖥️ Dashboard

The RoadGuard dashboard provides a centralized view of vehicle safety.

It includes:

**🗺️ Live Map**
Vehicle location and accident-prone zones.

**🚗 Vehicle Status**
GPS, GSM, IMU and vehicle status.

**⚠️ Risk Alerts**
Warnings when approaching high-risk zones.

**🚨 Emergency Alerts**
Real-time crash detection and SOS status.

**📊 Analytics**
Journey and safety statistics.

**🤖 AI Report**
Human-readable summary of the vehicle's journey.

---

## 🔄 System States

RoadGuard is designed around three primary safety states:

### 🟢 SAFE

Vehicle is operating normally.

### 🟡 DANGER

Vehicle is approaching a known accident-prone zone.

### 🔴 ACCIDENT

A potential crash has been detected and emergency response is triggered.

---

## 🚀 Future Scope

* Integration with larger city-wide traffic monitoring systems
* Machine-learning-based risk prediction
* Integration with additional vehicle sensors
* Fleet management for commercial vehicles
* Advanced accident severity estimation
* Mobile application for emergency contacts
* Expansion of accident-prone zone datasets

---

## 🏆 Hackathon Project

RoadGuard is being developed as a prototype demonstrating the integration of **IoT, GPS, GSM, real-time geofencing, web technologies and AI** into a unified vehicle safety system.

### Prevent. Detect. Respond.

🚗 **RoadGuard**
