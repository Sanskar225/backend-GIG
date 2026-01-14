# GigFlow Backend  
**Backend API for a Freelance Marketplace Platform**

![Node.js](https://img.shields.io/badge/Node.js-20.x-green)
![Express](https://img.shields.io/badge/Express-4.x-lightgrey)
![MongoDB](https://img.shields.io/badge/MongoDB-7.x-green)
![Status](https://img.shields.io/badge/Status-Production%20Ready-success)
![License](https://img.shields.io/badge/License-ISC-blue)

---

## 📌 Project Idea

GigFlow is a backend system designed to support a modern freelance marketplace where clients can post projects and freelancers can submit proposals.  
The project focuses on implementing real-world backend workflows such as user role separation, secure hiring logic, and scalable API design.

The backend is built to be frontend-agnostic and production-ready, making it suitable for integration with web or mobile applications.

---

## 🚀 What This Backend Provides

- Secure user authentication with role-based access  
- Gig creation and management for clients  
- Proposal (bidding) system for freelancers  
- Controlled hiring workflow to avoid conflicts  
- Real-time updates using WebSockets  
- API-level security and validation  

---

## ✨ Core Features

- JWT-based authentication and authorization  
- Role-based access control (Client / Freelancer)  
- Gig lifecycle management (Open, Assigned, Completed)  
- Atomic hiring logic using database transactions  
- Real-time notifications via Socket.IO  
- Centralized error handling and request validation  

---

## 🧱 Technology Stack

- Node.js  
- Express.js  
- MongoDB with Mongoose  
- Socket.IO  
- JWT & bcrypt  
- Jest & Supertest  

---

## ⚙️ Setup

### Prerequisites
- Node.js 18+  
- MongoDB  
- npm  

### Installation

```bash
git clone https://github.com/Sanskar225/backend-GIG.git
cd backend-GIG
npm install
npm run dev
