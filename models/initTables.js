const pool = require("./db");

async function createTables() {
  try {

    // table for push notifications
    await pool.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        endpoint TEXT NOT NULL,
        keys TEXT NOT NULL
      );
    `);

    // table for push notifications
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        endpoint TEXT UNIQUE,
        keys JSONB,
        created_at TIMESTAMP
      );
    `);

    // table for company info
    await pool.query(
      `CREATE TABLE IF NOT EXISTS company_info(
            id SERIAL PRIMARY KEY,
            logo_url TEXT NOT NULL,
            vision TEXT,
            mission TEXT,
            history TEXT,
            hero_image_url TEXT ,
            company_name TEXT NOT NULL,
            marquee_message TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP  
        );`
    );

    // table for pending users
    await pool.query(
      `CREATE TABLE IF NOT EXISTS pending_users(
        id SERIAL PRIMARY KEY,
        fullname TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT,
        gender TEXT,
        password TEXT NOT NULL,
        otp_code TEXT,
        otp_expires TIMESTAMP,
        profile_picture TEXT,
        role TEXT DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        dob DATE
        
        )`
    );

    // table for users
    await pool.query(
      `CREATE TABLE IF NOT EXISTS users2(
        id SERIAL PRIMARY KEY,
        fullname TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT,
        gender TEXT,
        password TEXT NOT NULL,
        profile_picture TEXT,
        role TEXT DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        reset_token TEXT,
        reset_token_expires TIMESTAMP,
        dob DATE,
        wallet_balance2 NUMERIC DEFAULT 0,
        xp INTEGER DEFAULT 0,
        child_code TEXT UNIQUE
      )`
    );

    // table for career pathways
    await pool.query(
      `CREATE TABLE IF NOT EXISTS career_pathways(
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        thumbnail_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        target_audience TEXT,
        expected_outcomes TEXT,
        duration_estimate TEXT,
        video_intro_url TEXT,
        show_on_homepage BOOLEAN DEFAULT false
      )`
    );

    // table for courses
    await pool.query(
      `CREATE TABLE IF NOT EXISTS courses (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        level TEXT CHECK (level IN ('Beginner', 'Intermediate', 'Advanced')),
        career_pathway_id INTEGER REFERENCES career_pathways(id) ON DELETE SET NULL,
        thumbnail_url TEXT,
        sort_order INTEGER DEFAULT 0,
        amount INTEGER DEFAULT 0,
        created_by TEXT DEFAULT 'admin',
        instructor_id INT REFERENCES users(id), 
        created_at TIMESTAMP DEFAULT NOW(),
        curriculum_url TEXT
      );`
    );

    // table for transactions
    await pool.query(
      `CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        fullname TEXT,
        email TEXT,
        amount NUMERIC,
        reference TEXT UNIQUE,
        status TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );`
    );

    //table for benefits
    await pool.query(
      `CREATE TABLE IF NOT EXISTS benefits (
        id SERIAL PRIMARY KEY,
        title TEXT,
        description TEXT,
        icon TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );`
    );

    // table for events
    await pool.query(`
      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        event_date DATE NOT NULL,
        time TEXT,
        location TEXT,
        is_paid BOOLEAN DEFAULT FALSE,
        amount NUMERIC DEFAULT 0,
        image_url TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        show_on_homepage BOOLEAN DEFAULT false,
        discount_amount NUMERIC DEFAULT 0,
        discount_deadline DATE,
        allow_split_payment BOOLEAN DEFAULT false
      );
    `);

    // table for event registrations
    await pool.query(
      `CREATE TABLE IF NOT EXISTS event_registrations (
    id SERIAL PRIMARY KEY,
    event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
    registrant_name TEXT NOT NULL,
    registrant_email TEXT NOT NULL,
    registrant_phone TEXT,
    amount_paid NUMERIC(10,2) DEFAULT 0,
    payment_status TEXT DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW(),
    balance_due NUMERIC DEFAULT 0,
    total_amount NUMERIC,
    num_people INTEGER DEFAULT 1,
    child_names JSONB DEFAULT '[]',
    payment_option TEXT DEFAULT 'full'
);
`
    );

    // table for about sections
    await pool.query(
      `CREATE TABLE IF NOT EXISTS about_sections (
        id SERIAL PRIMARY KEY,
        section_title TEXT NOT NULL,
        section_key TEXT UNIQUE NOT NULL,
        content TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW(),
        section_image TEXT,
        section_order INT
      );`
    );

    // tables for testimonies 
    await pool.query(`
      CREATE TABLE IF NOT EXISTS testimonies (
        id SERIAL PRIMARY KEY,
        name TEXT,
        email TEXT,
        message TEXT,
        is_published BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS feedback (
        id SERIAL PRIMARY KEY,
        user_type TEXT NOT NULL,   -- parent, teacher, organization, etc
        name TEXT NOT NULL,
        email TEXT,
        school_name TEXT,           -- only for school owners / teachers
        student_class TEXT,         -- only for parents/students
        organization_name TEXT,     -- only for organization
        rating INTEGER CHECK (rating >= 1 AND rating <= 5),
        category TEXT,
        message TEXT NOT NULL,
        extra JSONB,                -- flexible for future custom questions
        created_at TIMESTAMP DEFAULT NOW()
      );
      
     `);

    // table for faqs
    await pool.query(`
      CREATE TABLE IF NOT EXISTS faqs (
        id SERIAL PRIMARY KEY,
        question TEXT NOT NULL,
        answer TEXT,
        email TEXT,
        is_published BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // table for gallery categories
    await pool.query(
      `CREATE TABLE IF NOT EXISTS gallery_categories (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );`
    );

    // table for gallery images
    await pool.query(
      `CREATE TABLE IF NOT EXISTS gallery_images (
        id SERIAL PRIMARY KEY,
        title TEXT,
        image_url TEXT NOT NULL,
        category_id INT REFERENCES gallery_categories(id),
        uploaded_at TIMESTAMP DEFAULT NOW()
      );`
    );

    // table for modules
    await pool.query(
      `CREATE TABLE IF NOT EXISTS modules (
        id SERIAL PRIMARY KEY,
        course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        objectives TEXT,
        learning_outcomes TEXT,
        thumbnail TEXT,
        order_number INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      );
      `
    );

    // table for lessons
    await pool.query(
      `CREATE TABLE IF NOT EXISTS lessons (
        id SERIAL PRIMARY KEY,
        module_id INTEGER REFERENCES modules(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        content TEXT,
        video_url TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        order_number INTEGER,
        lesson_file_url TEXT
      );
      `
    );

    // table for lesson assignments
    await pool.query(
      `CREATE TABLE IF NOT EXISTS lesson_assignments (
        id SERIAL PRIMARY KEY,
        lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
        title TEXT,
        instructions TEXT,
        resource_url TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );`
    );

    // table for module assignments
    await pool.query(
      `CREATE TABLE IF NOT EXISTS module_assignments (
        id SERIAL PRIMARY KEY,
        module_id INTEGER REFERENCES modules(id) ON DELETE CASCADE,
        title TEXT,
        instructions TEXT,
        resource_url TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );`
    );

    // table for course projects
    await pool.query(
      `CREATE TABLE IF NOT EXISTS course_projects (
        id SERIAL PRIMARY KEY,
          course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          description TEXT,
          resource_url TEXT,
          created_at TIMESTAMP DEFAULT NOW()
      );
      `
    );

    // table for quizzes
    await pool.query(
      `CREATE TABLE IF NOT EXISTS quizzes (
        id SERIAL PRIMARY KEY,
        lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );`
    );

    // table for quiz questions
    await pool.query(
      `CREATE TABLE IF NOT EXISTS quiz_questions (
        id SERIAL PRIMARY KEY,
        quiz_id INTEGER REFERENCES quizzes(id) ON DELETE CASCADE,
        question TEXT NOT NULL,
        options TEXT[], -- e.g. ARRAY['A', 'B', 'C', 'D']
        correct_option TEXT NOT NULL,
        question_type VARCHAR(50) DEFAULT 'multiple_choice'
      );
      `
    );

      // table for course enrollments
    await pool.query(
      `CREATE TABLE IF NOT EXISTS course_enrollments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users2(id) ON DELETE CASCADE,
        course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
        enrolled_at TIMESTAMP DEFAULT NOW(),
        progress INTEGER DEFAULT 0
      );
      `
    );

    // table for tracking student XP
    await pool.query(
      `CREATE TABLE IF NOT EXISTS student_xp (
        user_id INTEGER PRIMARY KEY REFERENCES users2(id) ON DELETE CASCADE,
        xp INTEGER DEFAULT 0,
        level INTEGER DEFAULT 1
      );
      `
    );

    // table for tracking student badges
    await pool.query(
      `CREATE TABLE IF NOT EXISTS student_badges (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users2(id) ON DELETE CASCADE,
        title TEXT,
        awarded_at TIMESTAMP DEFAULT NOW()
      );
      `
    );

    // table for tracking user XP history
    await pool.query(
      `CREATE TABLE IF NOT EXISTS xp_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users2(id) ON DELETE CASCADE,
        xp INTEGER NOT NULL,
        activity TEXT, -- e.g., "Completed lesson", "Quiz passed"
        earned_at TIMESTAMP DEFAULT NOW()
      );
      `
    );

    // table for tracking user badges
    await pool.query(
      `
      CREATE TABLE IF NOT EXISTS user_badges (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users2(id) ON DELETE CASCADE,
        badge_name TEXT NOT NULL,
        awarded_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, badge_name),
        module_id INTEGER REFERENCES modules(id) ON DELETE CASCADE,
        badge_image TEXT
      );
      `
    );

    // table for tracking lesson completion
    await pool.query(
      `CREATE TABLE IF NOT EXISTS user_lesson_progress (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users2(id) ON DELETE CASCADE,
        lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
        completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, lesson_id)
      );
      `
    );

    // table for AI tutor logs
    await pool.query(
      `CREATE TABLE IF NOT EXISTS ai_tutor_logs (
        id SERIAL PRIMARY KEY,
        user_id INT NULL REFERENCES users2(id),
        lesson_id INT NULL REFERENCES lessons(id),
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      `
    );

    // table for assignment submissions
    await pool.query(
      `CREATE TABLE IF NOT EXISTS assignment_submissions (
          id SERIAL PRIMARY KEY,
          assignment_id INT NOT NULL, 
          student_id INT NOT NULL, 
          description TEXT NOT NULL,
          score INT,
          ai_feedback TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          file_url TEXT,
          grade TEXT,
          criteria JSON,
          total INT
      );
      `
    );

    await pool.query(`
      CREATE TABLE IF NOT EXISTS quiz_submissions (
      id SERIAL PRIMARY KEY,
      quiz_id INT NOT NULL,
      student_id INT NOT NULL,
      score INT,
      passed BOOLEAN,
      review_data TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    `);

    // junction table for unlocked lessons
    await pool.query(
      `CREATE TABLE IF NOT EXISTS unlocked_lessons (
        student_id INT NOT NULL,
        lesson_id INT NOT NULL,
        PRIMARY KEY(student_id, lesson_id)
      );
      `
    );

    // junction table for unlocked modules
    await pool.query(
      `
      CREATE TABLE IF NOT EXISTS unlocked_modules (
        student_id INT NOT NULL,
        module_id INT NOT NULL,
        PRIMARY KEY(student_id, module_id)
      );
      `
    );

  // junction table for unlocked assignments
    await pool.query(
      `
      CREATE TABLE IF NOT EXISTS unlocked_assignments (
        student_id INT NOT NULL,
        assignment_id INT NOT NULL,
        PRIMARY KEY(student_id, assignment_id)
      );
      `
    );

    // table for user certificates
    await pool.query(
      `CREATE TABLE IF NOT EXISTS user_certificates (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users2(id) ON DELETE CASCADE,
        course_id INT REFERENCES courses(id) ON DELETE CASCADE,
        issued_at TIMESTAMP DEFAULT NOW(),
        certificate_url TEXT
      );

      `
    );

    // table for parents
    await pool.query(
      `CREATE TABLE IF NOT EXISTS parent_children (
        id SERIAL PRIMARY KEY,
        parent_id INT REFERENCES users2(id) ON DELETE CASCADE,
        child_id INT REFERENCES users2(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(parent_id, child_id)
      );
      `
    );

    // table for parent-child requests
    await pool.query(
      `CREATE TABLE IF NOT EXISTS parent_child_requests (
        id SERIAL PRIMARY KEY,
        parent_id INT NOT NULL REFERENCES users2(id) ON DELETE CASCADE,
        child_id INT NOT NULL REFERENCES users2(id) ON DELETE CASCADE,
        status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (parent_id, child_id)
      );

      `
    );

    // tables for schools
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schools (
        id SERIAL PRIMARY KEY,
        school_id VARCHAR(20) UNIQUE NOT NULL, -- generated e.g. SCH-123456
        name TEXT NOT NULL,
        address TEXT,
        email TEXT,
        phone TEXT,
        created_by INT REFERENCES users2(id) ON DELETE CASCADE, -- school_admin
        created_at TIMESTAMP DEFAULT NOW(),
        logo_url TEXT
      );
    `);
    
    // junction table for users and schools
      await pool.query(`
        CREATE TABLE IF NOT EXISTS user_school (
          id SERIAL PRIMARY KEY,
          user_id INT REFERENCES users2(id) ON DELETE CASCADE,
          school_id INT REFERENCES schools(id) ON DELETE CASCADE,
          role_in_school TEXT CHECK (role_in_school IN ('teacher', 'student')),
          classroom_id INT,
          joined_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(user_id, school_id),
          approved BOOLEAN DEFAULT false
        );
      `);

      // table for classrooms
      await pool.query(`
        CREATE TABLE IF NOT EXISTS classrooms (
          id SERIAL PRIMARY KEY,
          school_id INT REFERENCES schools(id) ON DELETE CASCADE,
          name TEXT NOT NULL, -- e.g. "JSS1A"
          created_at TIMESTAMP DEFAULT NOW()
        );
      `);

      // junction table for quotes
    await pool.query(`
      CREATE TABLE IF NOT EXISTS quotes (
        id SERIAL PRIMARY KEY,
        school_id INT REFERENCES schools(id) ON DELETE CASCADE,
        requested_students INT NOT NULL,
        price_quote NUMERIC(12,2),
        status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected, negotiated
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // table for school payments
      await pool.query(`
        CREATE TABLE IF NOT EXISTS school_payments (
          id SERIAL PRIMARY KEY,
          school_id INT REFERENCES schools(id) ON DELETE CASCADE,
          quote_id INT REFERENCES quotes(id) ON DELETE SET NULL,
          student_limit INT NOT NULL, -- max students covered by this payment
          amount NUMERIC(12,2) NOT NULL,
          start_date DATE NOT NULL,
          end_date DATE NOT NULL,
          status VARCHAR(20) DEFAULT 'pending', -- pending, paid, overdue
          created_at TIMESTAMP DEFAULT NOW()
        );

      `);
    
    // table for school payment adjustments
    await pool.query(`
      CREATE TABLE IF NOT EXISTS school_payment_adjustments (
        id SERIAL PRIMARY KEY,
        school_payment_id INT REFERENCES school_payments(id) ON DELETE CASCADE,
        extra_students INT NOT NULL,
        extra_amount NUMERIC(12,2) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        status VARCHAR(20) DEFAULT 'pending' -- pending, paid
      );
    `);
    
    // junction table for school courses
        await pool.query(`
          CREATE TABLE IF NOT EXISTS school_courses (
            id SERIAL PRIMARY KEY,
            school_id INT REFERENCES schools(id) ON DELETE CASCADE,
            course_id INT REFERENCES courses(id) ON DELETE CASCADE,
            assigned_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(school_id, course_id)
          );
        `);

      // junction table for classroom teachers
    await pool.query(`
      CREATE TABLE IF NOT EXISTS classroom_teachers (
        id SERIAL PRIMARY KEY,
        classroom_id INT REFERENCES classrooms(id) ON DELETE CASCADE,
        teacher_id INT REFERENCES users2(id) ON DELETE CASCADE,
        UNIQUE (classroom_id, teacher_id)
      );

      `);

    // junction table for classroom courses
    await pool.query(`
      CREATE TABLE IF NOT EXISTS classroom_courses (
        id SERIAL PRIMARY KEY,
        classroom_id INT REFERENCES classrooms(id) ON DELETE CASCADE,
        course_id INT REFERENCES courses(id) ON DELETE CASCADE,
        assigned_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(classroom_id, course_id)
      );

      `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS activities (
          id SERIAL PRIMARY KEY,
          school_id INT REFERENCES schools(id) ON DELETE CASCADE,  -- nullable if not school-specific
          user_id INT REFERENCES users2(id) ON DELETE SET NULL,    -- who triggered the action
          role TEXT,                                               -- e.g. 'parent', 'school_admin', 'teacher', 'student'
          action TEXT NOT NULL,                                    -- short description: "New student joined"
          details TEXT,                                            -- optional: "John Doe (email)"
          scope TEXT DEFAULT 'global',                             -- 'global', 'school', 'classroom'
          created_at TIMESTAMP DEFAULT NOW()
        );

      `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS classroom_instructors (
        id SERIAL PRIMARY KEY,
        classroom_id INT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
        instructor_id INT NOT NULL REFERENCES users2(id) ON DELETE CASCADE,
        UNIQUE(classroom_id, instructor_id) -- prevent duplicates
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        sender_id INT REFERENCES users2(id) ON DELETE CASCADE,
        receiver_id INT REFERENCES users2(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        is_read BOOLEAN DEFAULT FALSE,
        is_delivered BOOLEAN DEFAULT FALSE
      );

      `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS project_submissions (
        id SERIAL PRIMARY KEY,
        student_id INT REFERENCES students(id),
        course_id INT REFERENCES courses(id),
        file_url TEXT NOT NULL,
        notes TEXT,
        submitted_at TIMESTAMP NOT NULL,
        UNIQUE(student_id, course_id)
      );

      `);

    console.log("✅ All tables are updated and ready.");
  } catch (err) {
    console.error("❌ Error creating tables:", err.message);
  }
}

module.exports = createTables;
