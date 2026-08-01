-- MySQL dump 10.13  Distrib 8.0.19, for Win64 (x86_64)
--
-- Host: localhost    Database: dfly_trips_dev
-- ------------------------------------------------------
-- Server version	8.4.9

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `booking_travelers`
--

DROP TABLE IF EXISTS `booking_travelers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `booking_travelers` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `booking_id` bigint unsigned NOT NULL,
  `first_name` varchar(50) NOT NULL,
  `last_name` varchar(50) DEFAULT NULL,
  `gender` char(1) DEFAULT NULL,
  `age` smallint unsigned DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `booking_id` (`booking_id`),
  CONSTRAINT `booking_travelers_ibfk_1` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `booking_travelers`
--

LOCK TABLES `booking_travelers` WRITE;
/*!40000 ALTER TABLE `booking_travelers` DISABLE KEYS */;
/*!40000 ALTER TABLE `booking_travelers` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `bookings`
--

DROP TABLE IF EXISTS `bookings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bookings` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `customer_id` bigint unsigned NOT NULL,
  `trip_id` bigint unsigned NOT NULL,
  `booking_number` varchar(30) DEFAULT NULL,
  `booking_status` char(1) DEFAULT NULL,
  `payment_status` char(1) DEFAULT NULL,
  `booking_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `total_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `bookings`
--

LOCK TABLES `bookings` WRITE;
/*!40000 ALTER TABLE `bookings` DISABLE KEYS */;
/*!40000 ALTER TABLE `bookings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `contact_messages`
--

DROP TABLE IF EXISTS `contact_messages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `contact_messages` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `name` varchar(100) NOT NULL,
  `email` varchar(100) DEFAULT NULL,
  `mobile` varchar(15) DEFAULT NULL,
  `subject` varchar(150) DEFAULT NULL,
  `message` text NOT NULL,
  `status` char(1) DEFAULT 'A',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `tenant_id` (`tenant_id`),
  CONSTRAINT `contact_messages_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `contact_messages`
--

LOCK TABLES `contact_messages` WRITE;
/*!40000 ALTER TABLE `contact_messages` DISABLE KEYS */;
/*!40000 ALTER TABLE `contact_messages` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `customer_favorites`
--

DROP TABLE IF EXISTS `customer_favorites`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `customer_favorites` (
  `customer_id` bigint unsigned NOT NULL,
  `trip_id` bigint unsigned NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`customer_id`,`trip_id`),
  KEY `trip_id` (`trip_id`),
  CONSTRAINT `customer_favorites_ibfk_1` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`),
  CONSTRAINT `customer_favorites_ibfk_2` FOREIGN KEY (`trip_id`) REFERENCES `trips` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `customer_favorites`
--

LOCK TABLES `customer_favorites` WRITE;
/*!40000 ALTER TABLE `customer_favorites` DISABLE KEYS */;
/*!40000 ALTER TABLE `customer_favorites` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `customers`
--

DROP TABLE IF EXISTS `customers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `customers` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `first_name` varchar(50) NOT NULL,
  `last_name` varchar(50) DEFAULT NULL,
  `email` varchar(100) NOT NULL,
  `mobile` varchar(15) DEFAULT NULL,
  `gender` char(1) DEFAULT NULL,
  `password_hash` varchar(255) NOT NULL,
  `status` char(1) NOT NULL DEFAULT 'A',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `phone_number` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_customers_email` (`tenant_id`,`email`),
  CONSTRAINT `customers_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `customers`
--

LOCK TABLES `customers` WRITE;
/*!40000 ALTER TABLE `customers` DISABLE KEYS */;
INSERT INTO `customers` VALUES (1,1,'DFly','Labs','dflylabs@gmail.com',NULL,NULL,'$2b$10$4NxU2uw09sOApJQsT6Y26uSnL8AwheUND2UDiy.t.59KhfhBF/kx.','A','2026-06-21 14:45:35','2026-06-21 14:45:35',''),(2,1,'a','','a@gmail.com',NULL,NULL,'$2b$10$f/Z4R/B6/.ccvSr2qLtaJODYa5hho89MmiX24CE8MeWIJElv37YEK','A','2026-06-21 14:50:26','2026-06-21 14:50:26',''),(3,1,'DFly','Labs','dflylabs1@gmail.com',NULL,NULL,'$2b$10$4Jckh6sRn0ff18Q2pWXdA.elrAluZGqgCQVS29os.5mqW00Bmowbu','A','2026-06-25 15:56:17','2026-06-25 15:56:17',''),(4,1,'DFly','Labs','dflylabs2@gmail.com',NULL,NULL,'$2b$10$NfekMvBVhEiUjVdyFeu7sebM1W4BLxH/31AikAx2tWAlCLxm.v6oG','A','2026-06-25 15:57:05','2026-06-25 15:57:05','12345678999'),(5,1,'DFly','Labs','dflylabs3@gmail.com',NULL,NULL,'$2b$10$cKca7a6LAjijlsrGVVQ4.uzwRXxQY/xbtrJ0YmafHYoEqGuWHWn8K','A','2026-06-25 16:00:56','2026-06-25 16:00:56',''),(6,1,'DFly','Labs','dflylabs5@gmail.com',NULL,NULL,'$2b$10$MhClG68POO84BxDPalfvTe25ZHaTg6lZvBz.GK5n1Uda0Bb81wSj.','A','2026-06-25 16:03:35','2026-06-25 16:03:35','');
/*!40000 ALTER TABLE `customers` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `master_trip_types`
--

DROP TABLE IF EXISTS `master_trip_types`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `master_trip_types` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `code` varchar(20) NOT NULL,
  `name` varchar(100) NOT NULL,
  `status` char(1) NOT NULL DEFAULT 'A',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_master_trip_types_code` (`code`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `master_trip_types`
--

LOCK TABLES `master_trip_types` WRITE;
/*!40000 ALTER TABLE `master_trip_types` DISABLE KEYS */;
INSERT INTO `master_trip_types` VALUES (1,'DOM','Domestic','A','2026-06-27 10:29:01'),(2,'INT','International','A','2026-06-27 10:29:01'),(3,'ADV','Adventure','A','2026-06-27 10:29:01'),(4,'REL','Religious','A','2026-06-27 10:29:01'),(5,'HON','Honeymoon','A','2026-06-27 10:29:01'),(6,'FAM','Family','A','2026-06-27 10:29:01'),(7,'COR','Corporate','A','2026-06-27 10:29:01');
/*!40000 ALTER TABLE `master_trip_types` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `parameters`
--

DROP TABLE IF EXISTS `parameters`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `parameters` (
  `parameter_type` varchar(30) NOT NULL,
  `parameter_code` char(1) NOT NULL,
  `parameter_name` varchar(50) NOT NULL,
  `description` varchar(200) DEFAULT NULL,
  `display_order` smallint unsigned DEFAULT '1',
  `status` char(1) DEFAULT 'A',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`parameter_type`,`parameter_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `parameters`
--

LOCK TABLES `parameters` WRITE;
/*!40000 ALTER TABLE `parameters` DISABLE KEYS */;
/*!40000 ALTER TABLE `parameters` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `payments`
--

DROP TABLE IF EXISTS `payments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payments` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `booking_id` bigint unsigned NOT NULL,
  `amount` decimal(12,2) DEFAULT NULL,
  `payment_method` char(1) DEFAULT NULL,
  `payment_status` char(1) DEFAULT NULL,
  `transaction_number` varchar(100) DEFAULT NULL,
  `payment_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `payment_reference` varchar(100) DEFAULT NULL,
  `gateway_payment_id` varchar(150) DEFAULT NULL,
  `transaction_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `refund_amount` decimal(12,2) DEFAULT NULL,
  `refund_status` char(1) DEFAULT NULL,
  `refunded_at` datetime DEFAULT NULL,
  `remarks` varchar(300) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `payments`
--

LOCK TABLES `payments` WRITE;
/*!40000 ALTER TABLE `payments` DISABLE KEYS */;
/*!40000 ALTER TABLE `payments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `status_master`
--

DROP TABLE IF EXISTS `status_master`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `status_master` (
  `status_type` varchar(30) NOT NULL,
  `status_code` char(1) NOT NULL,
  `status_name` varchar(50) NOT NULL,
  `description` varchar(200) DEFAULT NULL,
  `display_order` smallint unsigned DEFAULT '1',
  `status` char(1) DEFAULT 'A',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`status_type`,`status_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `status_master`
--

LOCK TABLES `status_master` WRITE;
/*!40000 ALTER TABLE `status_master` DISABLE KEYS */;
INSERT INTO `status_master` VALUES ('PAYMENT','F','Failed','Payment Failed',3,'A','2026-06-28 16:10:15'),('PAYMENT','P','Pending','Payment Pending',1,'A','2026-06-28 16:10:15'),('PAYMENT','R','Refunded','Payment Refunded',4,'A','2026-06-28 16:10:15'),('PAYMENT','S','Success','Payment Successful',2,'A','2026-06-28 16:10:15'),('PAYMENT_METHOD','C','Card',NULL,2,'A','2026-06-28 16:10:45'),('PAYMENT_METHOD','N','Net Banking',NULL,3,'A','2026-06-28 16:10:45'),('PAYMENT_METHOD','Q','QR Code',NULL,5,'A','2026-06-28 16:10:45'),('PAYMENT_METHOD','U','UPI',NULL,1,'A','2026-06-28 16:10:45'),('PAYMENT_METHOD','W','Wallet',NULL,4,'A','2026-06-28 16:10:45'),('REFUND','P','Pending',NULL,1,'A','2026-06-28 16:10:30'),('REFUND','S','Completed',NULL,2,'A','2026-06-28 16:10:30'),('TRIP','A','Active','Visible to customers',2,'A','2026-06-27 10:33:33'),('TRIP','D','Draft','Trip draft',1,'A','2026-06-27 10:33:33'),('TRIP','I','Inactive','Hidden from customers',3,'A','2026-06-27 10:33:33');
/*!40000 ALTER TABLE `status_master` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `tenant_themes`
--

DROP TABLE IF EXISTS `tenant_themes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tenant_themes` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `theme_code` varchar(20) NOT NULL,
  `theme_name` varchar(50) NOT NULL,
  `allow_dark_mode` char(1) DEFAULT 'Y',
  `default_mode` char(1) DEFAULT 'S',
  `customer_light_primary` char(7) DEFAULT NULL,
  `customer_light_secondary` char(7) DEFAULT NULL,
  `customer_light_accent` char(7) DEFAULT NULL,
  `customer_light_background` char(7) DEFAULT NULL,
  `customer_light_surface` char(7) DEFAULT NULL,
  `customer_light_text` char(7) DEFAULT NULL,
  `customer_dark_primary` char(7) DEFAULT NULL,
  `customer_dark_secondary` char(7) DEFAULT NULL,
  `customer_dark_accent` char(7) DEFAULT NULL,
  `customer_dark_background` char(7) DEFAULT NULL,
  `customer_dark_surface` char(7) DEFAULT NULL,
  `customer_dark_text` char(7) DEFAULT NULL,
  `admin_light_primary` char(7) DEFAULT NULL,
  `admin_light_secondary` char(7) DEFAULT NULL,
  `admin_light_accent` char(7) DEFAULT NULL,
  `admin_light_sidebar` char(7) DEFAULT NULL,
  `admin_light_background` char(7) DEFAULT NULL,
  `admin_light_surface` char(7) DEFAULT NULL,
  `admin_light_text` char(7) DEFAULT NULL,
  `admin_dark_primary` char(7) DEFAULT NULL,
  `admin_dark_secondary` char(7) DEFAULT NULL,
  `admin_dark_accent` char(7) DEFAULT NULL,
  `admin_dark_sidebar` char(7) DEFAULT NULL,
  `admin_dark_background` char(7) DEFAULT NULL,
  `admin_dark_surface` char(7) DEFAULT NULL,
  `admin_dark_text` char(7) DEFAULT NULL,
  `logo_light_url` varchar(100) DEFAULT NULL,
  `logo_dark_url` varchar(100) DEFAULT NULL,
  `favicon_light_url` varchar(100) DEFAULT NULL,
  `favicon_dark_url` varchar(100) DEFAULT NULL,
  `app_icon_light_url` varchar(100) DEFAULT NULL,
  `app_icon_dark_url` varchar(100) DEFAULT NULL,
  `login_background_light_url` varchar(100) DEFAULT NULL,
  `login_background_dark_url` varchar(100) DEFAULT NULL,
  `status` char(1) DEFAULT 'A',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tenant_themes`
--

LOCK TABLES `tenant_themes` WRITE;
/*!40000 ALTER TABLE `tenant_themes` DISABLE KEYS */;
INSERT INTO `tenant_themes` VALUES (1,1,'DFLY','DFly Default','Y','S','#46e583','#60A5FA','#F59E0B','#FFFFFF','#F8FAFC','#111827','#3B82F6','#60A5FA','#FBBF24','#0F172A','#1E293B','#FFFFFF','#2563EB','#60A5FA','#F59E0B','#FFFFFF','#F8FAFC','#FFFFFF','#111827','#3B82F6','#60A5FA','#FBBF24','#0F172A','#111827','#1E293B','#FFFFFF','logo-light.png','logo-dark.png','favicon-light.ico','favicon-dark.ico','app-light.png','app-dark.png','login-light.jpg','login-dark.jpg','A','2026-06-23 15:23:38','2026-06-25 18:09:12');
/*!40000 ALTER TABLE `tenant_themes` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `tenants`
--

DROP TABLE IF EXISTS `tenants`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tenants` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `code` varchar(20) NOT NULL,
  `name` varchar(100) NOT NULL,
  `email` varchar(100) DEFAULT NULL,
  `phone_number` varchar(15) DEFAULT NULL,
  `logo_url` varchar(500) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `status` varchar(1) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tenants`
--

LOCK TABLES `tenants` WRITE;
/*!40000 ALTER TABLE `tenants` DISABLE KEYS */;
INSERT INTO `tenants` VALUES (1,'dfly','DFly Internal','dflylabs@gmail.com','+917798651575',NULL,1,'2026-06-16 15:37:17','2026-06-21 15:10:16','A');
/*!40000 ALTER TABLE `tenants` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `trip_departures`
--

DROP TABLE IF EXISTS `trip_departures`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `trip_departures` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `trip_id` bigint unsigned NOT NULL,
  `departure_date` date NOT NULL,
  `departure_time` time NOT NULL,
  `return_date` date NOT NULL,
  `return_time` time NOT NULL,
  `booking_last_date` date DEFAULT NULL,
  `total_seats` smallint unsigned NOT NULL,
  `available_seats` smallint unsigned NOT NULL,
  `price` decimal(12,2) NOT NULL,
  `discounted_price` decimal(12,2) DEFAULT NULL,
  `status` char(1) DEFAULT 'A',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_departure_trip` (`trip_id`),
  CONSTRAINT `fk_departure_trip` FOREIGN KEY (`trip_id`) REFERENCES `trips` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `trip_departures`
--

LOCK TABLES `trip_departures` WRITE;
/*!40000 ALTER TABLE `trip_departures` DISABLE KEYS */;
INSERT INTO `trip_departures` VALUES (7,2,'2026-06-24','07:00:00','2026-06-25','18:00:00','2026-06-20',1,1,0.00,0.00,'A','2026-06-30 15:23:53');
/*!40000 ALTER TABLE `trip_departures` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `trip_exclusions`
--

DROP TABLE IF EXISTS `trip_exclusions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `trip_exclusions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `trip_id` bigint unsigned NOT NULL,
  `item` varchar(150) NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `trip_id` (`trip_id`),
  CONSTRAINT `trip_exclusions_ibfk_1` FOREIGN KEY (`trip_id`) REFERENCES `trips` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=15 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `trip_exclusions`
--

LOCK TABLES `trip_exclusions` WRITE;
/*!40000 ALTER TABLE `trip_exclusions` DISABLE KEYS */;
INSERT INTO `trip_exclusions` VALUES (13,2,'Cloths','2026-06-30 15:23:53'),(14,2,'External plans','2026-06-30 15:23:53');
/*!40000 ALTER TABLE `trip_exclusions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `trip_images`
--

DROP TABLE IF EXISTS `trip_images`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `trip_images` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `trip_id` bigint unsigned NOT NULL,
  `image_url` varchar(500) NOT NULL,
  `display_order` smallint unsigned DEFAULT '1',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `trip_id` (`trip_id`),
  CONSTRAINT `trip_images_ibfk_1` FOREIGN KEY (`trip_id`) REFERENCES `trips` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=14 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `trip_images`
--

LOCK TABLES `trip_images` WRITE;
/*!40000 ALTER TABLE `trip_images` DISABLE KEYS */;
INSERT INTO `trip_images` VALUES (9,2,'/image/upload/tripsImages/dfly-filled-removebg-preview.png',1,'2026-06-30 15:23:53'),(10,2,'/image/upload/tripsImages/dfly-filled.jpg',2,'2026-06-30 15:23:53'),(11,2,'/image/upload/tripsImages/8794.jpg',3,'2026-06-30 15:23:53'),(12,2,'https://res.cloudinary.com/dvoq9uw9j/image/upload/v1782833028/tripsImages/dfly-filled-removebg-preview_1782833028014.png',4,'2026-06-30 15:23:53'),(13,2,'https://res.cloudinary.com/dvoq9uw9j/image/upload/v1782833029/tripsImages/dfly-filled_1782833031814.jpg',5,'2026-06-30 15:23:53');
/*!40000 ALTER TABLE `trip_images` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `trip_inclusions`
--

DROP TABLE IF EXISTS `trip_inclusions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `trip_inclusions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `trip_id` bigint unsigned NOT NULL,
  `item` varchar(150) NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `trip_id` (`trip_id`),
  CONSTRAINT `trip_inclusions_ibfk_1` FOREIGN KEY (`trip_id`) REFERENCES `trips` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=36 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `trip_inclusions`
--

LOCK TABLES `trip_inclusions` WRITE;
/*!40000 ALTER TABLE `trip_inclusions` DISABLE KEYS */;
INSERT INTO `trip_inclusions` VALUES (31,2,'Breakfast','2026-06-30 15:23:53'),(32,2,'Lunch','2026-06-30 15:23:53'),(33,2,'Dinner','2026-06-30 15:23:53'),(34,2,'Stay','2026-06-30 15:23:53'),(35,2,'Tickets','2026-06-30 15:23:53');
/*!40000 ALTER TABLE `trip_inclusions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `trip_itinerary`
--

DROP TABLE IF EXISTS `trip_itinerary`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `trip_itinerary` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `trip_id` bigint unsigned NOT NULL,
  `day_number` smallint unsigned NOT NULL,
  `title` varchar(100) NOT NULL,
  `description` text,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `trip_id` (`trip_id`),
  CONSTRAINT `trip_itinerary_ibfk_1` FOREIGN KEY (`trip_id`) REFERENCES `trips` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=25 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `trip_itinerary`
--

LOCK TABLES `trip_itinerary` WRITE;
/*!40000 ALTER TABLE `trip_itinerary` DISABLE KEYS */;
INSERT INTO `trip_itinerary` VALUES (21,2,1,'Day 1','Check-in','2026-06-30 15:23:53'),(22,2,1,'Day 1','sdfgh','2026-06-30 15:23:53'),(23,2,2,'Day 2','Sunset','2026-06-30 15:23:53'),(24,2,2,'Day 2','dfghj','2026-06-30 15:23:53');
/*!40000 ALTER TABLE `trip_itinerary` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `trips`
--

DROP TABLE IF EXISTS `trips`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `trips` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `title` varchar(150) NOT NULL,
  `slug` varchar(150) NOT NULL,
  `destination` varchar(100) NOT NULL,
  `duration_days` smallint unsigned NOT NULL,
  `duration_nights` smallint unsigned NOT NULL,
  `description` text,
  `status` char(1) DEFAULT 'D',
  `trip_type_id` bigint unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_trips_trip_type` (`trip_type_id`),
  CONSTRAINT `fk_trips_trip_type` FOREIGN KEY (`trip_type_id`) REFERENCES `master_trip_types` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `trips`
--

LOCK TABLES `trips` WRITE;
/*!40000 ALTER TABLE `trips` DISABLE KEYS */;
INSERT INTO `trips` VALUES (2,1,'Malvan','malvan','Malvan',2,1,'','D',NULL);
/*!40000 ALTER TABLE `trips` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `first_name` varchar(50) NOT NULL,
  `last_name` varchar(50) DEFAULT NULL,
  `email` varchar(100) NOT NULL,
  `mobile` varchar(15) DEFAULT NULL,
  `password_hash` varchar(255) NOT NULL,
  `role_code` char(1) NOT NULL DEFAULT 'A',
  `status` char(1) NOT NULL DEFAULT 'A',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `phone_number` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`tenant_id`,`email`),
  CONSTRAINT `users_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,1,'DFly','Labs','dflylabs@gmail.com',NULL,'$2b$10$4NxU2uw09sOApJQsT6Y26uSnL8AwheUND2UDiy.t.59KhfhBF/kx.','A','A','2026-06-21 14:58:29','2026-06-21 14:58:29',NULL);
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping routines for database 'dfly_trips_dev'
--
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-07-01  0:14:07
